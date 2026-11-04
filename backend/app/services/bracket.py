"""본선 대진: 라운드 → 매치 → 슬롯.

슬롯은 팀을 직접 갖거나(team_id), 랭킹 순위(seed_rank, 화면에는 '예선 N위') 또는 이전 매치 결과
(source_match_id + source_rank)로 채워진다. 매치의 version 은 매치 자체나 그 슬롯이
바뀔 때마다 올라가서, 낡은 화면에서 결과를 입력하는 일을 막는다.
"""

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.errors import AppError, check_version, duplicate, invalid, not_found
from app.models import BracketRound, LiveState, Match, MatchSlot, Team, User, utcnow
from app.schemas import competition as s
from app.services import audit
from app.services.ranking import rank_to_team_id

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


# ---- 동결 ----


def frozen(db: Session) -> bool:
    """본선 결과를 동결했나."""
    live = db.get(LiveState, 1)
    return live is not None and live.bracket_frozen_at is not None


def _check_not_frozen(db: Session) -> None:
    if frozen(db):
        raise AppError(409, "BRACKET_FROZEN", "본선 결과를 동결해 대진과 결과를 바꿀 수 없습니다.")


def freeze(db: Session, actor: User | None) -> None:
    """지금 대진과 결과를 그대로 잠근다. 결과 입력·되돌리기, 대진 편집, 시드 채우기를 막는다."""
    _check_not_frozen(db)
    matches = db.scalars(select(Match).order_by(Match.id)).all()
    if not matches:
        raise invalid("본선 대진이 없습니다.")
    live = db.get(LiveState, 1)
    assert live is not None
    live.bracket_frozen_at = utcnow()
    audit.record(
        db,
        actor,
        "bracket_freeze",
        "matches",
        "*",
        None,
        {"finished": [m.label for m in matches if m.status == "finished"], "total": len(matches)},
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
    """끝난 매치에서 그 순위를 받은 팀. 그사이 비활성화(기권)한 팀은 다음 매치로 올리지 않는다."""
    if source.status != "finished" or rank is None:
        return None
    slot = next((slot for slot in source.slots if slot.result_rank == rank), None)
    if slot is None or slot.team is None or not slot.team.is_active:
        return None
    return slot.team_id


def _settled_empty(db: Session, slot: MatchSlot) -> bool:
    """빈 칸이 앞으로도 채워지지 않는지 (그러면 부전승으로 끝낼 수 있다)."""
    if slot.source_match_id is not None:
        source = db.get(Match, slot.source_match_id)
        if source is None or source.status == "finished":
            return True
        # 앞 매치의 두 팀이 모두 기권해 그 매치를 끝낼 수 없으면 이 칸도 채워지지 않는다
        return all(s.team_id is None and _settled_empty(db, s) for s in source.slots)
    if slot.seed_rank is not None:
        # 그 순위 팀이 없거나, 이미 다른 칸에 있으면 시드 채우기로도 들어오지 않는다
        team_id = rank_to_team_id(db).get(slot.seed_rank)
        return team_id is None or (
            db.scalar(
                select(MatchSlot.id).where(MatchSlot.team_id == team_id, MatchSlot.id != slot.id)
            )
            is not None
        )
    return True  # 직접 지정 칸을 비워 둔 것


def _active_team(db: Session, team_id: int) -> Team:
    team = db.get(Team, team_id)
    if team is None or not team.is_active:
        raise invalid("활성 상태의 팀이 아닙니다.")
    return team


# ---- 라운드 ----


def create_round(db: Session, body: s.BracketRoundCreate, actor: User) -> BracketRound:
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    _check_not_frozen(db)
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
    elif "team_id" not in changes and (
        (slot.source_match_id is not None and changes.get("source_match_id", 0) is None)
        or ("seed_rank" in changes and changes["seed_rank"] != slot.seed_rank)
    ):
        # 출처를 끊거나 시드 순위를 바꾸면 예전 팀을 남기지 않는다 (시드 채우기로 다시 채운다)
        new["team_id"] = None
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


def swap_slots(db: Session, body: s.BracketSlotSwap, actor: User) -> None:
    """두 칸의 자리를 바꾼다. 팀과 함께 채우는 방법(예선 순위·앞 매치 결과·자리표시)도 옮겨서
    '예선 3위'·'Race 1 승' 표시가 팀을 따라가고, 어느 칸의 연결도 사라지지 않는다.
    """
    _check_not_frozen(db)
    if body.slot_id == body.target_slot_id:
        raise invalid("같은 칸끼리는 바꿀 수 없습니다.")
    pair = [(get_slot(db, body.slot_id), body.version)]
    pair.append((get_slot(db, body.target_slot_id), body.target_version))
    for slot, version in pair:
        if slot.match.status == "finished":
            raise _match_finished()
        check_version(slot.match.version, version)

    slot, target = pair[0][0], pair[1][0]
    befores = {slot.id: audit.snapshot(slot), target.id: audit.snapshot(target)}
    for field in SLOT_FIELDS:
        value = getattr(slot, field)
        setattr(slot, field, getattr(target, field))
        setattr(target, field, value)
    db.flush()

    for moved in (slot, target):
        others = [other for other in moved.match.slots if other.id != moved.id]
        if moved.team_id is not None and moved.team_id in {o.team_id for o in others}:
            raise invalid(f"{moved.match.label}에 같은 팀이 두 번 들어가게 됩니다.")
        if moved.seed_rank is not None and moved.seed_rank in {o.seed_rank for o in others}:
            raise invalid(f"{moved.match.label}에 같은 예선 순위가 두 번 들어가게 됩니다.")
        if moved.source_match_id is None:
            continue
        if (moved.source_match_id, moved.source_rank) in {
            (o.source_match_id, o.source_rank) for o in others
        }:
            raise invalid(f"{moved.match.label}에 같은 출처가 두 번 들어가게 됩니다.")
        if _creates_cycle(db, moved.match_id, moved.source_match_id):
            raise invalid(
                f"이렇게 바꾸면 {moved.match.label} 매치가 자기 결과를 기다리게 됩니다. 앞 경기"
                " 결과를 받는 칸은 그 앞 경기나 더 앞 경기로 옮길 수 없습니다."
            )

    for match in {slot.match, target.match}:
        match.bump_version()
    for moved in (slot, target):
        audit.record_change(db, actor, "swap", moved, befores[moved.id])


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
    _check_not_frozen(db)
    if match.status == "finished":
        raise _match_finished()
    check_version(match.version, body.version)
    # 빈 칸은 부전승: 결과 없이 끝낸다. 다만 아직 채워질 칸(시드 전, 앞 매치 진행 전)이면 막는다
    slots = {slot.id: slot for slot in match.slots if slot.team_id is not None}
    if not slots:
        raise invalid("팀이 하나도 없는 매치는 끝낼 수 없습니다.")
    empty = [slot for slot in match.slots if slot.team_id is None]
    if any(not _settled_empty(db, slot) for slot in empty):
        raise invalid(
            "아직 채워질 칸이 있습니다. '랭킹으로 시드 채우기'를 하거나 앞 매치를 먼저 끝내세요."
        )
    slot_ids = [r.slot_id for r in body.results]
    if len(set(slot_ids)) != len(slot_ids) or set(slot_ids) != slots.keys():
        raise invalid("팀이 있는 모든 칸에 결과를 한 번씩 입력해야 합니다 (빈 칸은 빼고).")
    if sorted(r.result_rank for r in body.results) != list(range(1, len(slots) + 1)):
        raise invalid("순위는 1부터 빠짐없이, 겹치지 않게 매겨야 합니다.")
    team_ids = [slot.team_id for slot in slots.values()]
    if len(set(team_ids)) != len(team_ids):
        raise invalid("같은 팀이 한 매치에 두 번 들어 있습니다. 대진 칸을 먼저 고치세요.")
    withdrawn = [slot.team.name_ko for slot in slots.values() if not slot.team.is_active]
    if withdrawn:
        raise invalid(
            f"비활성화된 팀이 들어 있습니다: {', '.join(withdrawn)}. 대진 칸에서 빼고 다시 하세요."
        )

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
    _check_not_frozen(db)
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
        # 끝난 뒤 비활성화(기권)한 팀은 다시 겨루지 않는다
        if slot.team is not None and not slot.team.is_active:
            slot.team_id = None
    live = db.get(LiveState, 1)
    match.status = "live" if live is not None and live.current_match_id == match.id else "scheduled"
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


def seed_from_ranking(db: Session, actor: User | None) -> None:
    """seed_rank 슬롯을 랭킹 표의 그 순위 팀으로 채운다. 본선 경기가 하나라도 끝났으면 막는다.

    경기 중 기권하면 랭킹이 당겨지므로, 그 뒤에 다시 채우면 다른 팀이 칸을 옮기거나 부전승으로
    올라가야 할 팀이 빠진다. 규칙 5.1.3 은 기권한 팀의 상대가 다음 단계로 가므로 칸을 그대로 둔다.
    """
    _check_not_frozen(db)
    if db.scalar(select(Match.id).where(Match.status == "finished").limit(1)) is not None:
        raise AppError(
            409,
            "BRACKET_STARTED",
            "본선 경기가 이미 시작되어 시드를 다시 채울 수 없습니다. 기권한 팀의 칸은 비워 두면"
            " 상대 팀이 부전승으로 올라갑니다. 칸을 바꿔야 하면 관리자 화면의 대진 편집에서"
            " 고치세요.",
        )
    team_by_rank = rank_to_team_id(db)
    slots = db.scalars(
        select(MatchSlot).where(MatchSlot.seed_rank.is_not(None)).order_by(MatchSlot.id)
    ).all()
    # 다른 칸(직접 지정한 칸)에 이미 있는 팀은 다시 넣지 않는다 (한 팀이 두 매치에 들어가지 않게)
    refill = {slot.id for slot in slots}
    placed = set(
        db.scalars(
            select(MatchSlot.team_id).where(
                MatchSlot.team_id.is_not(None), MatchSlot.id.not_in(refill)
            )
        )
    )
    changes = []
    for slot in slots:
        team_id = team_by_rank.get(slot.seed_rank)
        if team_id in placed:
            team_id = None
        if team_id is not None:
            placed.add(team_id)
        if slot.team_id != team_id:
            changes.append({"slot_id": slot.id, "before": slot.team_id, "after": team_id})
            slot.team_id = team_id
            slot.match.bump_version()
    if changes:
        audit.record(db, actor, "seed", "match_slots", "*", None, {"changes": changes})


def remove_team(db: Session, team_id: int, actor: User | None) -> None:
    """비활성화(기권)한 팀을 끝나지 않은 매치의 칸에서 뺀다. 끝난 매치의 결과는 기록으로 남긴다.

    본선 결과를 동결했으면 칸을 그대로 둔다.
    """
    if frozen(db):
        return
    slots = db.scalars(
        select(MatchSlot)
        .join(MatchSlot.match)
        .where(MatchSlot.team_id == team_id, Match.status != "finished")
        .order_by(MatchSlot.id)
    ).all()
    if not slots:
        return
    for slot in slots:
        slot.team_id = None
        slot.match.bump_version()
    changes = [{"slot_id": slot.id, "before": team_id, "after": None} for slot in slots]
    audit.record(db, actor, "update", "match_slots", "*", None, {"changes": changes})


# ---- 자동 생성 (P2) ----


def _seed_order(size: int) -> list[int]:
    """1-8, 4-5, 2-7, 3-6 처럼 상위 시드가 늦게 만나도록 배치한다."""
    order = [1, 2]
    while len(order) < size:
        total = len(order) * 2 + 1
        order = [seed for top in order for seed in (top, total - top)]
    return order


def generate(db: Session, body: s.BracketGenerate, actor: User | None) -> None:
    _check_not_frozen(db)
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
