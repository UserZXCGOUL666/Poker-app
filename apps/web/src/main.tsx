import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { ACCENT_STORAGE_KEY, applyAccentColor } from './lib/theme';
import './styles.css';
import './hud-theme.css';
import './hud-v2.css';

applyAccentColor(localStorage.getItem(ACCENT_STORAGE_KEY));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider><App /></AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
