import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './tft-iq-quiz-card.jsx'; // ← 이 줄

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)