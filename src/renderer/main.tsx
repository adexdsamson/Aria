import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/theme/globals.css';

// Defense-in-depth — if the preload bridge is missing, surface it loudly. The
// renderer must never import from the electron module; window.aria is the only allowed surface.
if (!window.aria) {
  // eslint-disable-next-line no-console
  console.error('Preload bridge missing — window.aria is undefined.');
}

// Phase 9 Plan 02 — activate editorial heading scopes (h1-h4 defaults from
// globals.css are wrapped under :where(.editorial)). One-shot at boot.
document.body.classList.add('editorial');

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('Aria: #root element missing from index.html');

createRoot(rootEl).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
