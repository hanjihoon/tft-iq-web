import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './tft-iq-quiz-card.jsx';


// 1. 아래 패키지를 import 하세요
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';

// 2. 앱 실행 시 분석 기능을 활성화합니다
injectSpeedInsights();
inject();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
) 