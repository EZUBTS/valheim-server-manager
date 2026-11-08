import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import App from '@/App';
import { installGlobalErrorLogging } from '@/lib/logging';
import { initTheme } from '@/lib/theme';
import { revealMainWindow } from '@/lib/window';
// oxlint-disable-next-line import/no-unassigned-import -- Tailwind entry stylesheet
import '@/styles/globals.css';

// Apply the persisted theme and wire global logging before the first render.
initTheme();
installGlobalErrorLogging();

const container = document.getElementById('root');

if (!container) {
  throw new Error('Root element #root was not found');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// The window is created hidden to avoid a white flash; reveal it after the
// first painted frame. The Rust side has a fallback if this never runs.
void revealMainWindow();
