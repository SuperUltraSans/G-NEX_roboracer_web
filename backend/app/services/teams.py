"""팀 비활성화(기권): 예선 랭킹·본선·진행 상태 어디에도 남지 않게 정리한다."""

from sqlalchemy.orm import Session

from app.models import Team, User
from app.services import bracket, live_state, ranking


def withdraw(db: Session, team: Team, actor: User | None) -> None:
    """랭킹에서 빼고(아래 순위가 당겨진다), 끝나지 않은 매치 칸을 비우고, 트랙 위 팀이면 비운다.

    예선 기록과 끝난 매치 결과는 기록으로 남긴다. 리더보드·공개 팀 목록은 활성 팀만 보인다.
    다시 활성화해도 랭킹과 대진 칸은 되돌리지 않는다(운영진이 다시 정한다).
    """
    ranking.drop_team(db, team.id, actor)
    bracket.remove_team(db, team.id, actor)
    live_state.clear_team(db, team.id, actor)
