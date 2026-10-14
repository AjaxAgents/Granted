import '@fontsource/ibm-plex-sans/latin-400.css';
import '@fontsource/ibm-plex-sans/latin-500.css';
import '@fontsource/ibm-plex-sans/latin-600.css';
import '@fontsource/ibm-plex-mono/latin-500.css';
import '@fontsource/ibm-plex-mono/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-500.css';
import '@fontsource/barlow-semi-condensed/latin-600.css';
import '@fontsource/barlow-semi-condensed/latin-700.css';
import './styles.css';
import { createRoot } from 'react-dom/client';
import { Capacitor } from '@capacitor/core';
import { App } from './App';
import { AppProvider } from './state';
import { DemoApi } from './lib/demo-api';
import { HttpApi } from './lib/http-api';
import type { Api } from './lib/api';

// VITE_API_BASE set at build time = talk to the Granted API. Not set = the offline demo.
const base = (import.meta.env.VITE_API_BASE as string | undefined) || '';
const api: Api = base ? new HttpApi(base.replace(/\/$/, '')) : new DemoApi();

function hideSplash() {
  (window as unknown as { __grantedReady?: boolean }).__grantedReady = true;
  const sp = document.getElementById('splash');
  if (sp) { sp.classList.add('out'); setTimeout(() => sp.remove(), 400); }
  if (Capacitor.isNativePlatform()) import('@capacitor/splash-screen').then((m) => m.SplashScreen.hide()).catch(() => undefined);
}

if (Capacitor.isNativePlatform()) {
  import('@capacitor/status-bar').then((m) => m.StatusBar.setStyle({ style: m.Style.Dark })).catch(() => undefined);
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <AppProvider api={api} onReady={hideSplash}><App /></AppProvider>,
);
