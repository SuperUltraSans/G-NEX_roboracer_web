import { useTranslation } from 'react-i18next'
import { ButtonLink } from '../../components/Button'

export function HeroActions({ className }: { className?: string }) {
  const { t } = useTranslation()
  return (
    <div className={className}>
      <ButtonLink to="/apply" variant="darkPrimary">
        {t('home.applyCta')}
      </ButtonLink>
      <ButtonLink to="/live" variant="darkOutline">
        {t('home.liveCta')}
      </ButtonLink>
    </div>
  )
}
