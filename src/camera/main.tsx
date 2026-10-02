import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import { keepUpdated } from '../shared/pwa'
import { App } from './App'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

keepUpdated()
