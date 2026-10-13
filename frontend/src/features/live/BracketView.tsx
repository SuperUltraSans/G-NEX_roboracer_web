import { useTranslation } from 'react-i18next'
import type { Bracket, BracketMatch } from '../../api/types'
import { useLang } from '../../i18n'
import { pickLocalized } from '../../lib/localized'
import { useHighlights } from './highlights'
import { slotPlaceholder, teamName } from './labels'
import styles from './BracketView.module.css'

export function BracketView({ data, currentMatchId }: { data: Bracket; currentMatchId?: number }) {
  const { t } = useTranslation()
  const lang = useLang()
  const rounds = [...data.rounds].sort((a, b) => a.sort_order - b.sort_order)

  return (
    <>
      <p className={styles.hint}>{t('live.bracket.scrollHint')}</p>
      {/* 좁은 화면에서는 대진 영역만 가로로 스크롤한다 */}
      <div
        className={styles.scroller}
        tabIndex={0}
        role="region"
        aria-label={t('live.bracket.title')}
      >
        <ol className={styles.rounds}>
          {rounds.map((round) => (
            <li key={round.id} className={styles.round}>
              <h3 className={styles.roundName}>{pickLocalized(round, 'name', lang)}</h3>
              <ol className={styles.matches}>
                {[...round.matches]
                  .sort((a, b) => a.sort_order - b.sort_order)
                  .map((match) => (
                    <MatchCard key={match.id} match={match} current={match.id === currentMatchId} />
                  ))}
              </ol>
            </li>
          ))}
        </ol>
      </div>
    </>
  )
}

function MatchCard({ match, current }: { match: BracketMatch; current: boolean }) {
  const { t } = useTranslation()
  const lang = useLang()
  const { matches: updated } = useHighlights()
  const slots = [...match.slots].sort((a, b) => a.slot_index - b.slot_index)

  return (
    <li
      className={styles.match}
      data-status={match.status}
      data-current={current ? '' : undefined}
      data-updated={updated.has(match.id) ? '' : undefined}
    >
      <div className={styles.matchHead}>
        <span className={`num ${styles.label}`}>{match.label}</span>
        <span className={styles.badge} data-status={match.status}>
          {t(`live.bracket.status.${match.status}`)}
        </span>
      </div>
      <ol className={styles.slots}>
        {slots.map((slot) => (
          <li
            key={slot.id}
            className={styles.slot}
            data-winner={match.status === 'finished' && slot.result_rank === 1 ? '' : undefined}
          >
            {slot.team ? (
              <span className={styles.slotTeam}>
                <span className={`record ${styles.slotCar}`}>{slot.team.car_number}</span>
                <span className={styles.slotName}>{teamName(slot.team, lang)}</span>
              </span>
            ) : (
              <span className={styles.slotPlaceholder}>{slotPlaceholder(slot, lang, t)}</span>
            )}
            {(slot.result_rank || slot.result_text) && (
              <span className={styles.result}>
                {slot.result_rank && (
                  <span className={`record ${styles.resultRank}`}>
                    {t('live.bracket.winner', { rank: slot.result_rank })}
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
