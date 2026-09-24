import React from 'react';
import { createRoot } from 'react-dom/client';
import '@yabloko/ui/styles.css';
import { App } from './App.js';

const container = document.getElementById('root');
if (!container) throw new Error('#root не найден');

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
