import React from 'react';
import ReactDOM from 'react-dom/client';
import { vim, getCM } from '@replit/codemirror-vim';
import App from './App';
import './styles/globals.css';
import { applyPrefs, usePrefs } from './stores/prefsStore';

// Apply persisted prefs immediately (the inline boot script in index.html
// handles the FOUC; this re-applies once Zustand has rehydrated).
applyPrefs(usePrefs.getState());

// Expose dependencies for runtime-loaded plugins
(window as unknown as Record<string, unknown>).__krytonPluginDeps = { React, vim, getCM };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
