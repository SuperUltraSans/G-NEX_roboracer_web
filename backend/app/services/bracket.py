"""본선 대진: 라운드 → 매치 → 슬롯.

슬롯은 팀을 직접 갖거나(team_id), 예선 순위(seed_rank) 또는 이전 매치 결과
(source_match_id + source_rank)로 채워진다. 매치의 version 은 매치 자체나 그 슬롯이
바뀔 때마다 올라가서, 낡은 화면에서 결과를 입력하는 일을 막는다.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.errors import AppError, check_version, duplicate, invalid, not_found
from app.models import BracketRound, LiveState, Match, MatchSlot, Team, User
from app.schemas import competition as s
from app.services import audit
from app.services.leaderboard import build_leaderboard, rank_to_team_id

ROUND_NAMES = {2: ("결승", "Final"), 4: ("4강", "Semifinal"), 8: ("8강", "Quarterfinal")}
SLOT_FIELDS = (
    "team_id",
    "seed_rank",
    "source_match_id",
    "source_rank",
    "placeholder_ko",
    "placeholder_en",
)


def _match_finished() -> AppError:
    return AppError(409, "MATCH_FINISHED", "이미 종료된 매치입니다. 먼저 결과를 되돌리세요.")


def _downstream_finished() -> AppError:
    return AppError(
        409, "DOWNSTREAM_FINISHED", "이 매치의 결과를 받은 후속 매치가 이미 종료되었습니다."
    )


# ---- 조회 ----


def build_bracket(db: Session) -> s.Bracket:
    rounds = db.scalars(
        select(BracketRound)
        .order_by(BracketRound.sort_order, BracketRound.id)
        .options(
            selectinload(BracketRound.matches)
            .selectinload(Match.slots)
            .options(selectinload(MatchSlot.team), selectinload(MatchSlot.source_match))
        )
        .execution_options(populate_existing=True)
    )
    return s.Bracket(rounds=[s.BracketRound.model_validate(r) for r in rounds])


def get_round(db: Session, round_id: int) -> BracketRound:
    round_ = db.get(BracketRound, round_id)
    if round_ is None:
        raise not_found("라운드")
    return round_


def get_match(db: Session, match_id: int) -> Match:
    match = db.get(Match, match_id)
    if match is None:
        raise not_found("매치")
    return match


def get_slot(db: Session, slot_id: int) -> MatchSlot:
    slot = db.get(MatchSlot, slot_id)
    if slot is None:
        raise not_found("슬롯")
    return slot


def _downstream_slots(db: Session, match_ids: list[int]) -> list[MatchSlot]:
    return list(db.scalars(select(MatchSlot).where(MatchSlot.source_match_id.in_(match_ids))))


def _result_team(source: Match, rank: int | None) -> int | None:
    if source.status != "finished" or rank is None:
        return None
    return next((slot.team_id for slot in source.slots if slot.result_rank == rank), None)


def _active_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    return team


# ---- 라운드 ----


def create_round(db: Session, body: s.BracketRoundCreate, actor: User) -> BracketRound:
    sort_order = body.sort_order
    if sort_order is None:
        sort_order = (db.scalar(select(func.max(BracketRound.sort_order))) or 0) + 1
    round_ = BracketRound(name_ko=body.name_ko, name_en=body.name_en, sort_order=sort_order)
    db.add(round_)
    audit.record_change(db, actor, "create", round_, None)
    return round_


def update_round(
    db: Session, round_: BracketRound, body: s.BracketRoundUpdate, actor: User
) -> BracketRound:
    before = audit.snapshot(round_)
    for key, value in body.model_dump(exclude_unset=True).items():
        setattr(round_, key, value)
    audit.record_change(db, actor, "update", round_, before)
    return round_


def _detach_matches(db: Session, match_ids: list[int]) -> bool:
    """지울 매치를 가리키는 다른 슬롯의 출처를 끊고, 진행 상태에서 빼낸다.

    진행 상태의 current_match 가 바뀌었으면 True.
    """
    for slot in _downstream_slots(db, match_ids):
        if slot.match_id not in match_ids:
            slot.source_match_id = None
            slot.source_rank = None
            slot.match.bump_version()
    live = db.get(LiveState, 1)
    if live is not None and live.current_match_id in match_ids:
        live.current_match_id = None
        return True
    return False


def delete_round(db: Session, round_: BracketRound, actor: User) -> bool:
    before = audit.snapshot(round_)
    live_changed = _detach_matches(db, [m.id for m in round_.matches])
    db.delete(round_)
    audit.record_change(db, actor, "delete", round_, before)
    return live_changed


# ---- 매치 ----


def _ensure_unique_label(db: Session, label: str) -> None:
    if db.scalar(select(Match.id).where(Match.label == label)) is not None:
        raise duplicate(f"매치 라벨 {label} 이(가) 이미 있습니다.")


def create_match(db: Session, body: s.BracketMatchCreate, actor: User) -> Match:
    round_ = db.get(BracketRound, body.round_id)
    if round_ is None:
        raise invalid("라운드가 없습니다.")
    _ensure_unique_label(db, body.label)
    sort_order = body.sort_order
    if sort_order is None:
        sort_order = max((m.sort_order for m in round_.matches), default=0) + 1
    match = Match(
        round_id=round_.id,
        label=body.label,
        sort_order=sort_order,
        scheduled_at=body.scheduled_at,
        slots=[MatchSlot(slot_index=i) for i in range(body.slot_count)],
    )
    db.add(match)
    audit.record_change(db, actor, "create", match, None)
    return match


def _resize_slots(db: Session, match: Match, count: int) -> None:
    current = len(match.slots)
    if count > current:
        match.slots.extend(MatchSlot(slot_index=i) for i in range(current, count))
    elif count < current:
        removed = match.slots[count:]
        if any(slot.team_id is not None or slot.result_rank is not None for slot in removed):
            raise invalid("팀이나 결과가 있는 슬롯은 줄일 수 없습니다.")
        if any(
            slot.source_rank is not None and slot.source_rank > count
            for slot in _downstream_slots(db, [match.id])
        ):
            raise invalid("다른 매치가 이 매치의 없어질 순위를 참조하고 있습니다.")
        del match.slots[count:]


def update_match(db: Session, match: Match, body: s.BracketMatchUpdate, actor: User) -> Match:
    check_version(match.version, body.version)
    changes = body.model_dump(exclude_unset=True, exclude={"version"})
    before = audit.snapshot(match)
    if "label" in changes and changes["label"] != match.label:
        _ensure_unique_label(db, changes["label"])
    if "round_id" in changes and db.get(BracketRound, changes["round_id"]) is None:
        raise invalid("라운드가 없습니다.")
    if match.status == "finished" and (
        changes.get("status", "finished") != "finished" or "slot_count" in changes
    ):
        raise _match_finished()
    if "slot_count" in changes:
        _resize_slots(db, match, changes.pop("slot_count"))
    for key, value in changes.items():
        setattr(match, key, value)
    match.bump_version()
    audit.record_change(db, actor, "update", match, before)
    return match


def delete_match(db: Session, match: Match, actor: User) -> bool:
    before = audit.snapshot(match)
    live_changed = _detach_matches(db, [match.id])
    db.delete(match)
    audit.record_change(db, actor, "delete", match, before)
    return live_changed


# ---- 슬롯 ----


def _creates_cycle(db: Session, match_id: int, source_match_id: int) -> bool:
    """source 의 상류를 따라가다 자기 매치를 만나면 순환이다."""
    seen: set[int] = set()
    stack = [source_match_id]
    while stack:
        current = stack.pop()
        if current == match_id:
            return True
        if current in seen:
            continue
        seen.add(current)
        stack.extend(
            db.scalars(
                select(MatchSlot.source_match_id).where(
                    MatchSlot.match_id == current, MatchSlot.source_match_id.is_not(None)
                )
            )
        )
    return False


def update_slot(db: Session, slot: MatchSlot, body: s.BracketSlotUpdate, actor: User) -> Match:
    match = slot.match
    if match.status == "finished":
        raise _match_finished()
    changes = body.model_dump(exclude_unset=True)
    new = {field: changes.get(field, getattr(slot, field)) for field in SLOT_FIELDS}

    has_source = new["source_match_id"] is not None
    if (new["source_rank"] is not None) != has_source:
        raise invalid("source_match_id 와 source_rank 는 함께 지정해야 합니다.")
    if new["seed_rank"] is not None and has_source:
        raise invalid("예선 순위와 이전 매치 결과를 동시에 지정할 수 없습니다.")
    source = None
    if has_source:
        source = db.get(Match, new["source_match_id"])
        if source is None:
            raise invalid("출처 매치가 없습니다.")
        if source.id == match.id:
            raise invalid("슬롯이 자기 매치를 출처로 가리킬 수 없습니다.")
        if _creates_cycle(db, match.id, source.id):
            raise invalid("대진에 순환 참조가 생깁니다.")
        if new["source_rank"] > len(source.slots):
            raise invalid("출처 매치의 슬롯 수보다 큰 순위입니다.")
        if "team_id" not in changes and {"source_match_id", "source_rank"} & changes.keys():
            # 이미 끝난 매치를 출처로 연결하면 결과대로 바로 채운다
            new["team_id"] = _result_team(source, new["source_rank"])
    if "team_id" in changes and new["team_id"] is not None:
        _active_team(db, new["team_id"])

    others = [other for other in match.slots if other.id != slot.id]
    if new["team_id"] is not None and new["team_id"] in {o.team_id for o in others}:
        raise invalid("같은 매치에 같은 팀을 두 번 넣을 수 없습니다.")
    if new["seed_rank"] is not None and new["seed_rank"] in {o.seed_rank for o in others}:
        raise invalid("같은 매치에 같은 예선 순위가 이미 있습니다.")
    if has_source and (new["source_match_id"], new["source_rank"]) in {
        (o.source_match_id, o.source_rank) for o in others
    }:
        raise invalid("같은 매치에 같은 출처가 이미 있습니다.")

    before = audit.snapshot(slot)
    for field, value in new.items():
        setattr(slot, field, value)
    match.bump_version()
    audit.record_change(db, actor, "update", slot, before)
    return match


# ---- 결과 ----


def _propagate(db: Session, match: Match) -> None:
    """이 매치를 출처로 하는 슬롯을 결과(또는 결과 없음)에 맞춰 채운다."""
    for slot in _downstream_slots(db, [match.id]):
        team_id = _result_team(match, slot.source_rank)
        if slot.team_id == team_id:
            continue
        if slot.match.status == "finished":
            raise _downstream_finished()
        slot.team_id = team_id
        slot.match.bump_version()


def submit_result(db: Session, match: Match, body: s.MatchResultSubmit, actor: User) -> Match:
    if match.status == "finished":
        raise _match_finished()
    check_version(match.version, body.version)
    slots = {slot.id: slot for slot in match.slots}
    slot_ids = [r.slot_id for r in body.results]
    if len(set(slot_ids)) != len(slot_ids) or set(slot_ids) != slots.keys():
        raise invalid("매치의 모든 슬롯에 결과를 한 번씩 입력해야 합니다.")
    if any(slot.team_id is None for slot in slots.values()):
        raise invalid("팀이 정해지지 않은 슬롯이 있습니다.")
    if sorted(r.result_rank for r in body.results) != list(range(1, len(slots) + 1)):
        raise invalid("순위는 1부터 빠짐없이, 겹치지 않게 매겨야 합니다.")

    before = _result_snapshot(match)
    for result in body.results:
        slots[result.slot_id].result_rank = result.result_rank
        slots[result.slot_id].result_text = result.result_text
    match.status = "finished"
    match.bump_version()
    _propagate(db, match)
    db.flush()
    audit.record(db, actor, "finish", "matches", match.id, before, _result_snapshot(match))
    return match


def reopen_match(db: Session, match: Match, body: s.MatchReopen, actor: User) -> Match:
    if match.status != "finished":
        raise AppError(409, "MATCH_NOT_FINISHED", "종료되지 않은 매치입니다.")
    if body.version is not None:
        check_version(match.version, body.version)
    downstream = _downstream_slots(db, [match.id])
    if any(slot.match.status == "finished" for slot in downstream):
        raise _downstream_finished()

    before = _result_snapshot(match)
    for slot in downstream:
        if slot.team_id is not None:
            slot.team_id = None
            slot.match.bump_version()
    for slot in match.slots:
        slot.result_rank = None
        slot.result_text = None
    match.status = "scheduled"
    match.bump_version()
    db.flush()
    audit.record(db, actor, "reopen", "matches", match.id, before, audit.snapshot(match))
    return match


def _result_snapshot(match: Match) -> dict:
    data = audit.snapshot(match)
    data["results"] = [
        {"slot_id": slot.id, "team_id": slot.team_id, "rank": slot.result_rank}
        for slot in match.slots
    ]
    return data


def seed_from_qualifying(db: Session, actor: User | None) -> None:
    """seed_rank 슬롯을 현재 리더보드 순위의 팀으로 채운다. 종료된 매치는 건드리지 않는다."""
    team_by_rank = rank_to_team_id(build_leaderboard(db))
    slots = db.scalars(
        select(MatchSlot)
        .join(MatchSlot.match)
        .where(MatchSlot.seed_rank.is_not(None), Match.status != "finished")
        .order_by(MatchSlot.id)
    )
    changes = []
    for slot in slots:
        team_id = team_by_rank.get(slot.seed_rank)
        if slot.team_id != team_id:
            changes.append({"slot_id": slot.id, "before": slot.team_id, "after": team_id})
            slot.team_id = team_id
            slot.match.bump_version()
    audit.record(db, actor, "seed", "match_slots", "*", None, {"changes": changes})


# ---- 자동 생성 (P2) ----


def _seed_order(size: int) -> list[int]:
    """1-8, 4-5, 2-7, 3-6 처럼 상위 시드가 늦게 만나도록 배치한다."""
    order = [1, 2]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [seed for top in order for seed in (top, total - top)]
    return order


def generate(db: Session, body: s.BracketGenerate, actor: User | None) -> None:
    if db.scalar(select(func.count()).select_from(BracketRound)):
        raise AppError(409, "BRACKET_EXISTS", "이미 대진이 있습니다. 기존 라운드를 먼저 지우세요.")
    seeds = _seed_order(body.size)
    labels = (f"M{n}" for n in range(1, body.size * 2))
    previous: list[Match] = []
    teams_left = body.size
    sort_order = 1
    while teams_left >= 2:
        name_ko, name_en = ROUND_NAMES.get(
            teams_left, (f"{teams_left}강", f"Round of {teams_left}")
        )
        if teams_left == 2 and body.third_place and len(previous) == 2:
            third = BracketRound(name_ko="3·4위전", name_en="Third place", sort_order=sort_order)
            third.matches = [
                Match(label=next(labels), sort_order=1, slots=_sourced_slots(previous, rank=2))
            ]
            db.add(third)
            sort_order += 1
        round_ = BracketRound(name_ko=name_ko, name_en=name_en, sort_order=sort_order)
        matches = []
        for i in range(teams_left // 2):
            if previous:
                slots = _sourced_slots(previous[2 * i : 2 * i + 2], rank=1)
            else:
                slots = [
                    MatchSlot(slot_index=0, seed_rank=seeds[2 * i]),
                    MatchSlot(slot_index=1, seed_rank=seeds[2 * i + 1]),
                ]
            matches.append(Match(label=next(labels), sort_order=i + 1, slots=slots))
        round_.matches = matches
        db.add(round_)
        previous = matches
        teams_left //= 2
        sort_order += 1
    db.flush()
    audit.record(db, actor, "generate", "bracket_rounds", "*", None, body.model_dump())


def _sourced_slots(sources: list[Match], rank: int) -> list[MatchSlot]:
    return [
        MatchSlot(slot_index=i, source_match=source, source_rank=rank)
        for i, source in enumerate(sources)
    ]
