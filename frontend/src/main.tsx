import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthContext'
import './index.css'
import './refinement.css'
import { LanguageProvider } from './lib/i18n'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <LanguageProvider><AuthProvider>
        <App />
      </AuthProvider></LanguageProvider>
    </BrowserRouter>
  </StrictMode>,
)
