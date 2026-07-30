import React from 'react';
import ReactDOM from 'react-dom/client';
// Imported for its init-on-import side effect (see the file) — must happen
// before App renders so a crash during the very first render is still
// caught by the ErrorBoundary below.
import { Sentry } from './lib/sentry.js';
import { initPWAUpdates } from './lib/pwaUpdate.js';
import App from './App.jsx';
import './styles/global.css';

initPWAUpdates();

function ErrorFallback() {
  return (
    <div style={{ padding: 40, textAlign: 'center', fontFamily: 'monospace' }}>
      <p>Something went wrong. Try refreshing the page.</p>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </Sentry.ErrorBoundary>
  </React.StrictMode>
);
