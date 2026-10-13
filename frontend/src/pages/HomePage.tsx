import { useDocumentTitle } from '../app/useDocumentTitle'
import { NextUp, Sponsors } from '../features/home/NextUp'
import { PitwallHero, PitwallIntro } from '../features/home/Pitwall'

export function HomePage() {
  useDocumentTitle()
  return (
    <>
      <PitwallHero />
      <PitwallIntro />
      <NextUp />
      <Sponsors />
    </>
  )
}
