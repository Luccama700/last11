import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { inject } from '@vercel/analytics';
import { injectSpeedInsights } from '@vercel/speed-insights';
import '@fontsource/barlow-condensed/500.css';
import '@fontsource/barlow-condensed/600.css';
import '@fontsource/barlow-condensed/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import App from './App';
import './index.css';

inject();
injectSpeedInsights();

// Dev affordance: ?fast skips reels/playback (the tests' animate={false} path).
const fast = new URLSearchParams(window.location.search).has('fast');

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App animate={!fast} />
  </StrictMode>,
);
