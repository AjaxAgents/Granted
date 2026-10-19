import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  // The page may only talk to its own origin and the Granted API.
  // VITE_API_BASE=/api (same origin, the Azure one-click set-up) needs nothing extra.
  const api = env.VITE_API_BASE && /^https?:/.test(env.VITE_API_BASE) ? new URL(env.VITE_API_BASE).origin : '';
  return {
    base: './',
    plugins: [
      react(),
      { name: 'csp-connect-src', transformIndexHtml: (html: string) => html.replace('%VITE_CONNECT_SRC%', api) },
    ],
    build: { outDir: 'dist', sourcemap: false, target: 'es2022', chunkSizeWarningLimit: 900 },
    server: { port: 5173 },
  };
});
