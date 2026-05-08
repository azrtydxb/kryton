import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles/globals.css';
import { applyPrefs, usePrefs } from './stores/prefsStore';

// Apply persisted prefs immediately (the inline boot script in index.html
// handles the FOUC; this re-applies once Zustand has rehydrated).
applyPrefs(usePrefs.getState());

// Expose dependencies for runtime-loaded plugins.
// NOTE: vim/getCM removed — vim mode is not supported in the in-house editor (v1 gap).
(window as unknown as Record<string, unknown>).__krytonPluginDeps = { React };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
