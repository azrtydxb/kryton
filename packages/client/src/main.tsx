import React from 'react';
import ReactDOM from 'react-dom/client';
import { vim, getCM } from '@replit/codemirror-vim';
import App from './App';
import './styles/globals.css';

// Expose dependencies for runtime-loaded plugins
(window as unknown as Record<string, unknown>).__krytonPluginDeps = { React, vim, getCM };

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
