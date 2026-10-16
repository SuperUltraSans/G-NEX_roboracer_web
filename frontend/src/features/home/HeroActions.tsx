import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../../components/Button'
import { usePageState } from '../content/hooks'

export function HeroActions({ className }: { className?: string }) {
  const { t } = useTranslation()
  // 모니터링 페이지를 닫았으면 실시간 기록 버튼은 뺀다
  const live = usePageState('live')
  return (
    <div className={className}>
      <ButtonLink to="/apply" variant="darkPrimary">
        {t('home.applyCta')}
      </ButtonLink>
      {live.status !== 'closed' && (
        <ButtonLink to="/live" variant="darkOutline">
          {t('home.liveCta')}
        </ButtonLink>
      )}
    </div>
  )
}
