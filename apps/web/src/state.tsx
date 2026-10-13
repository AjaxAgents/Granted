/*
 * App state shared by every screen: the API, who is signed in, the open
 * project's view (already filtered by the server for this person's role),
 * maintenance mode, and a toast for short messages.
 */
import type { Role } from '@granted/core';
import type { HomeView, ProjectView } from '@granted/services';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ApiError, type Api } from './lib/api';
import { site, type Site } from './lib/format';
import { getPref, setPref } from './lib/storage';

export type Screen = 'login' | 'signup' | 'verify' | 'forgot' | 'home';
export type SheetId = 'add' | 'settings' | null;

export interface AppState {
  api: Api;
  screen: Screen;
  go(s: Screen): void;
  verifyEmail: string; setVerifyEmail(e: string): void;
  devCode: string; setDevCode(c: string): void;
  home: HomeView | null;
  view: ProjectView | null;
  pid: string | null;
  setPid(id: string | null): void;
  role: Role | null;
  site: Site | null;
  maint: { on: boolean; as: Role };
  setMaint(m: { on: boolean; as: Role }): void;
  sheet: SheetId; setSheet(s: SheetId): void;
  refresh(): Promise<void>;
  /** Runs an action; shows its error as a toast. Returns undefined on failure. */
  run<T>(fn: () => Promise<T>, ok?: string | ((r: T) => string)): Promise<T | undefined>;
  toast(msg: string): void;
  signedIn(message?: string): Promise<void>;
  signOut(): Promise<void>;
  tick: number;
}

const Ctx = createContext<AppState | null>(null);
export const useApp = () => { const c = useContext(Ctx); if (!c) throw new Error('no app'); return c; };

export function AppProvider({ api, children, onReady }: { api: Api; children: ReactNode; onReady: () => void }) {
  const [screen, setScreen] = useState<Screen | null>(null);
  const [home, setHome] = useState<HomeView | null>(null);
  const [view, setView] = useState<ProjectView | null>(null);
  const [pid, setPidState] = useState<string | null>(getPref<string | null>('granted.pid', null));
  const [maint, setMaintState] = useState<{ on: boolean; as: Role }>(getPref('granted.maint', { on: false, as: 'admin' as Role }));
  const [sheet, setSheet] = useState<SheetId>(null);
  const [toastMsg, setToastMsg] = useState('');
  const [verifyEmail, setVerifyEmail] = useState('');
  const [devCode, setDevCode] = useState('');
  const [tick, setTick] = useState(Date.now());
  const toastTimer = useRef(0);
  const pidRef = useRef(pid); pidRef.current = pid;

  const toast = useCallback((m: string) => { setToastMsg(m); clearTimeout(toastTimer.current); toastTimer.current = window.setTimeout(() => setToastMsg(''), 4000); }, []);

  api.viewAs = maint.on && maint.as !== 'admin' ? maint.as : null;

  const loadView = useCallback(async (h: HomeView, want: string | null) => {
    const id = want && h.projects.find((p) => p.id === want) ? want : (h.projects[0] ? h.projects[0].id : null);
    if (id !== pidRef.current) { setPidState(id); setPref('granted.pid', id); }
    if (!id) { setView(null); return; }
    try { setView(await api.project(id)); }
    catch (e) { if (e instanceof ApiError && (e.status === 403 || e.status === 404)) setView(null); else throw e; }
  }, [api]);

  const refresh = useCallback(async () => {
    if (!api.isSignedIn()) return;
    try {
      const h = await api.home();
      setHome(h);
      for (const n of h.notices) toast(n);
      await loadView(h, pidRef.current);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) { setHome(null); setView(null); setScreen('login'); toast('Your session ended. Sign in again.'); }
      else if (e instanceof ApiError && e.code === 'offline') toast(e.message);
    }
    setTick(Date.now());
  }, [api, loadView, toast]);

  const run = useCallback(async <T,>(fn: () => Promise<T>, ok?: string | ((r: T) => string)) => {
    try {
      const r = await fn();
      if (ok) toast(typeof ok === 'string' ? ok : ok(r));
      return r;
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Something went wrong.');
      if (e instanceof ApiError && e.status === 401) { setScreen('login'); }
      return undefined;
    }
  }, [toast]);

  // Start-up: restore the session, then show the app once the splash has had its moment.
  useEffect(() => {
    let alive = true;
    const minSplash = new Promise((r) => setTimeout(r, 1100));
    (async () => {
      const ok = await api.restore().catch(() => false);
      if (ok) await refresh();
      await minSplash;
      if (!alive) return;
      setScreen(ok ? 'home' : 'login');
      onReady();
    })();
    return () => { alive = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Live updates: re-read every 30 seconds and when the app comes back to the foreground.
  useEffect(() => {
    if (screen !== 'home') return;
    const t = setInterval(() => { refresh(); }, 30000);
    const vis = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', vis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [screen, refresh]);

  // Re-read the project when the project or the maintenance view changes.
  useEffect(() => { if (screen === 'home' && home) loadView(home, pid).catch(() => undefined); }, [pid, maint.on, maint.as]); // eslint-disable-line react-hooks/exhaustive-deps

  const value = useMemo<AppState>(() => {
    const realRole = view ? view.realRole : null;
    const nowInstant = api.now();
    return {
      api, screen: screen || 'login', go: (s) => { setScreen(s); window.scrollTo(0, 0); },
      verifyEmail, setVerifyEmail, devCode, setDevCode,
      home, view, pid,
      setPid: (id) => { setPidState(id); setPref('granted.pid', id); },
      role: view ? view.role : null,
      site: view ? site(view, nowInstant) : null,
      maint: realRole === 'admin' && home?.me.isAdminAccount ? maint : { on: false, as: 'admin' },
      setMaint: (m) => { setMaintState(m); setPref('granted.maint', m); },
      sheet, setSheet, refresh, run, toast,
      signedIn: async (message?: string) => { setScreen('home'); await refresh(); if (message) toast(message); },
      signOut: async () => { await api.signOut(); setHome(null); setView(null); setMaintState({ on: false, as: 'admin' }); setPref('granted.maint', null); setSheet(null); setScreen('login'); toast('Signed out.'); },
      tick,
    };
  }, [api, screen, verifyEmail, devCode, home, view, pid, maint, sheet, refresh, run, toast, tick]);

  return (
    <Ctx.Provider value={value}>
      {screen ? children : null}
      <div className="toast" role="status" aria-live="polite" hidden={!toastMsg}>{toastMsg}</div>
    </Ctx.Provider>
  );
}
