import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '../../../components/Button'
import styles from './admin.module.css'

/** 글을 클립보드에 복사한다. 복사되면 잠깐 '복사됨'으로 바뀐다 */
export function CopyButton({ text, label }: { text: string; label?: string }) {
  const { t } = useTranslation()
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')

  useEffect(() => {
    if (state === 'idle') return
    const timer = window.setTimeout(() => setState('idle'), 2000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }

  return (
    <Button variant="secondary" className={styles.compact} onClick={() => void copy()}>
      <span aria-live="polite">
        {state === 'copied'
          ? t('admin.common.copied')
          : state === 'failed'
            ? t('admin.common.copyFailed')
            : (label ?? t('admin.common.copy'))}
      </span>
    </Button>
  )
}
