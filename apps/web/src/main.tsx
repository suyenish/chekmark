import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
// Astryx: its reset and component styles first. The Chekmark theme and its bundled fonts are loaded by astryx-themes.
import '@astryxdesign/core/reset.css';
import '@astryxdesign/core/astryx.css';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
