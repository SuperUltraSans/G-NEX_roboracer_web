import { useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Bracket, BracketMatch, BracketRound } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { splitRounds, winnerLinks } from './bracketLayout'
import { useHighlights } from './highlights'
import { matchResult, slotPlaceholder, teamName } from './labels'
import { useConnectors } from './useConnectors'
import styles from './BracketView.module.css'

export function BracketView({
  data,
  currentMatchId,
  placementBeside = false,
}: {
  data: Bracket
  currentMatchId?: number
  /** 순위결정전을 본 대진 아래가 아니라 오른쪽 열에 둔다 (프로젝터 큰 화면: 한 화면에 다 보이게) */
  placementBeside?: boolean
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const { main, placement } = useMemo(() => splitRounds(data.rounds), [data.rounds])
  // 앞 매치의 칸 수: 두 칸이면 'Race 2 승'처럼 쓴다
  const slotCounts = useMemo(
    () =>
      new Map(
        data.rounds
          .flatMap((round) => round.matches)
          .map((match) => [match.id, match.slots.length]),
      ),
    [data.rounds],
  )
  const links = useMemo(() => winnerLinks(main), [main])
  const [board, setBoard] = useState<HTMLDivElement | null>(null)
  const connectors = useConnectors(board, links)
  const markerId = useId()

  return (
    <>
      <p className={styles.hint}>{t('live.bracket.scrollHint')}</p>
      <div className={placementBeside ? styles.beside : undefined}>
        {/* 좁은 화면에서는 대진 영역만 가로로 스크롤한다 */}
        <div
          className={styles.scroller}
          tabIndex={0}
          role="region"
          aria-label={t('live.bracket.title')}
        >
          <div ref={setBoard} className={styles.board}>
            <ol className={styles.rounds}>
              {main.map((round) => (
                <li key={round.id} className={styles.round}>
                  <h3 className={styles.roundName}>{pickLocalized(round, 'name', lang)}</h3>
                  <ol className={styles.matches}>
                    {sortedMatches(round).map((match) => (
                      <MatchCard
                        key={match.id}
                        match={match}
                        current={match.id === currentMatchId}
                        slotCounts={slotCounts}
                      />
                    ))}
                  </ol>
                </li>
              ))}
            </ol>
            {/* 승자가 올라가는 길. 앞 경기가 끝나면 실선, 아직이면 점선 (글로도 'Race 2 1위'처럼 적혀 있다) */}
            <svg className={styles.connectors} aria-hidden="true" focusable="false">
              <defs>
                {(['done', 'wait'] as const).map((state) => (
                  <marker
                    key={state}
                    id={`${markerId}-${state}`}
                    viewBox="0 0 8 8"
                    refX="8"
                    refY="4"
                    markerWidth="8"
                    markerHeight="8"
                    markerUnits="userSpaceOnUse"
                    orient="auto"
                  >
                    <path
                      d="M0 0L8 4L0 8z"
                      className={styles.arrowHead}
                      data-done={state === 'done' ? '' : undefined}
                    />
                  </marker>
                ))}
              </defs>
              {connectors.map((connector) => (
                <path
                  key={connector.key}
                  d={connector.d}
                  className={styles.link}
                  data-done={connector.done ? '' : undefined}
                  markerEnd={`url(#${markerId}-${connector.done ? 'done' : 'wait'})`}
                />
              ))}
            </svg>
          </div>
        </div>
        {/* 3·4위전·5~8위전처럼 패자끼리 붙는 경기는 본 대진 아래 한 줄로 */}
        {placement.length > 0 && (
          <section className={styles.placement} aria-labelledby="placement-title">
            <h3 id="placement-title" className={styles.roundName}>
              {t('live.bracket.placement')}
            </h3>
            <ol className={styles.placementList}>
              {placement.flatMap((round) =>
                sortedMatches(round).map((match) => (
                  <MatchCard
                    key={match.id}
                    match={match}
                    current={match.id === currentMatchId}
                    slotCounts={slotCounts}
                    caption={pickLocalized(round, 'name', lang)}
                  />
                )),
              )}
            </ol>
          </section>
        )}
      </div>
    </>
  )
}

function sortedMatches(round: BracketRound): BracketMatch[] {
  return [...round.matches].sort((a, b) => a.sort_order - b.sort_order)
}

function MatchCard({
  match,
  current,
  slotCounts,
  caption,
}: {
  match: BracketMatch
  current: boolean
  slotCounts: ReadonlyMap<number, number>
  /** 순위결정전에서 어느 경기인지 (예: 3·4위전) */
  caption?: string | null
}) {
  const { t } = useTranslation()
  const lang = useLang()
  const { matches: updated } = useHighlights()
  const slots = [...match.slots].sort((a, b) => a.slot_index - b.slot_index)

  return (
    <li
      className={styles.match}
      data-match-id={match.id}
      data-status={match.status}
      data-current={current ? '' : undefined}
      data-updated={updated.has(match.id) ? '' : undefined}
    >
      <div className={styles.matchHead}>
        <span className={styles.label}>
          <span className="num">{match.label}</span>
          {caption && <span className={styles.caption}> · {caption}</span>}
        </span>
        <span className={styles.badge} data-status={match.status}>
          {t(`live.bracket.status.${match.status}`)}
        </span>
      </div>
      <ol className={styles.slots}>
        {slots.map((slot) => (
          <li
            key={slot.id}
            className={styles.slot}
            data-slot-id={slot.id}
            data-winner={match.status === 'finished' && slot.result_rank === 1 ? '' : undefined}
          >
            {slot.team ? (
              <span className={styles.slotTeam}>
                <span className={styles.slotName}>{teamName(slot.team, lang)}</span>
              </span>
            ) : (
              <span className={styles.slotPlaceholder}>
                {slotPlaceholder(
                  slot,
                  lang,
                  t,
                  slot.source_match_id !== null ? slotCounts.get(slot.source_match_id) : undefined,
                )}
              </span>
            )}
            {(slot.result_rank || slot.result_text) && (
              <span className={styles.result}>
                {slot.result_rank && (
                  <span className={`record ${styles.resultRank}`}>
                    {matchResult(t, slot.result_rank, match.slots.length)}
                  </span>
                )}
                {slot.result_text && (
                  <span className={`record ${styles.resultText}`}>{slot.result_text}</span>
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </li>
  )
}
