import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './index.css';
import './i18n';
import { useAuthStore } from './store/auth';
import { useThemeStore } from './store/theme';
import { api } from './api/client';

useAuthStore.getState().init();
useThemeStore.getState().init();

api.setOnUnauthorized(() => {
  useAuthStore.getState().logout();
});

const getBasename = () => {
  return window.location.pathname.startsWith('/cc-connect') ? '/cc-connect' : '/';
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={getBasename()}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
