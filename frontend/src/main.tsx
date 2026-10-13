import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-600.css'
import '@fontsource/ibm-plex-sans-kr/400.css'
import '@fontsource/ibm-plex-sans-kr/500.css'
import '@fontsource/ibm-plex-sans-kr/700.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app/App'
import './i18n'
import './styles/tokens.css'
import './styles/global.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
