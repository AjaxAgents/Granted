import type { Role } from '@granted/core';
import type { GateCheckView } from '@granted/services';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { fmtDate } from '@granted/core';
import { plural, roleLabel } from '../lib/format';
import { useApp } from '../state';
import { Icons } from '../ui/components';
import { ProjectPanel } from '../panels/Project';
import { ConfirmPanel, MessagesPanel, MinePanel, SchedulePanel } from '../panels/Contractor';
import { GateLogPanel, ReceivePanel, TodayPanel } from '../panels/Gate';
import { ActivityPanel, ApprovalsPanel, DeliveriesPanel, EmergencyPanel, OverviewPanel, ProjectSettingsPanel, TeamPanel } from '../panels/Admin';
import { AddProjectSheet, SettingsSheet } from './Sheets';

export interface GateState { res?: GateCheckView; source?: string; logged?: string; error?: string; busy?: boolean }
interface HomeState {
  openTab(id: string): void;
  editing: string | null; setEditing(id: string | null): void;
  gate: GateState; setGate(g: GateState): void;
  runCheck(code: string, source: string): Promise<void>;
}
const HomeCtx = createContext<HomeState | null>(null);
export const useHome = () => { const c = useContext(HomeCtx); if (!c) throw new Error('no home'); return c; };

interface TabDef { id: string; title: string; icon: ReactNode; Panel: () => ReactNode }
const T = {
  project: { id: 'project', title: '', icon: Icons.site, Panel: ProjectPanel },
  confirm: { id: 'confirm', title: 'Confirm Delivery', icon: Icons.qr, Panel: ConfirmPanel },
  schedule: { id: 'schedule', title: 'Schedule Delivery', icon: Icons.cal, Panel: SchedulePanel },
  mine: { id: 'mine', title: 'My Deliveries', icon: Icons.truck, Panel: MinePanel },
  messages: { id: 'messages', title: 'Messages', icon: Icons.inbox, Panel: MessagesPanel },
  receive: { id: 'receive', title: 'Receive Delivery', icon: Icons.scan, Panel: ReceivePanel },
  today: { id: 'today', title: 'Expected Today', icon: Icons.list, Panel: TodayPanel },
  gatelog: { id: 'gatelog', title: 'Gate Log', icon: Icons.log, Panel: GateLogPanel },
  overview: { id: 'overview', title: 'Today', icon: Icons.chart, Panel: OverviewPanel },
  approvals: { id: 'approvals', title: 'Approvals', icon: Icons.check, Panel: ApprovalsPanel },
  team: { id: 'team', title: 'Team & Invites', icon: Icons.users, Panel: TeamPanel },
  deliveries: { id: 'deliveries', title: 'All Deliveries', icon: Icons.truck, Panel: DeliveriesPanel },
  emergency: { id: 'emergency', title: 'Emergency Pass', icon: Icons.bolt, Panel: EmergencyPanel },
  activity: { id: 'activity', title: 'Activity', icon: Icons.log, Panel: ActivityPanel },
  psettings: { id: 'psettings', title: 'Project Settings', icon: Icons.sliders, Panel: ProjectSettingsPanel },
} satisfies Record<string, TabDef>;

export function tabsFor(r: Role | null): TabDef[] {
  if (r === 'contractor') return [T.project, T.confirm, T.schedule, T.mine, T.messages];
  if (r === 'access') return [T.project, T.receive, T.today, T.gatelog];
  if (r === 'admin') return [T.project, T.overview, T.approvals, T.team, T.receive, T.schedule, T.confirm, T.deliveries, T.emergency, T.activity, T.psettings];
  return [T.project];
}

function useTabHead(id: string): { title: string; sub: string; badge: number } {
  const { view, site, home, role, pid } = useApp();
  const def = (T as Record<string, TabDef>)[id];
  if (id === 'project') {
    const p = view?.project;
    const pend = home?.pending.length || 0;
    const many = (home?.projects.length || 0) > 1;
    return { title: p ? p.name : 'No project yet', sub: p ? `${roleLabel(role)} · ${p.code}${many ? ' · tap to switch' : ''}` : pend ? 'Request waiting for approval' : 'Tap + to add a project code', badge: 0 };
  }
  if (!view || !site || !pid) return { title: def.title, sub: '', badge: 0 };
  const me = home?.me.id;
  const reqs = view.requests;
  const todayN = reqs.filter((r) => r.date === site.today && r.status === 'approved').length;
  switch (id) {
    case 'confirm': { const n = reqs.filter((r) => r.status === 'approved' && r.date >= site.today && site.passOf(r)?.status === 'active' && r.subId === view.mySub.id).length; return { title: def.title, sub: n ? `${plural(n, 'gate pass')} ready` : 'No gate passes yet', badge: 0 }; }
    case 'schedule': return { title: def.title, sub: `${view.project.settings.minNoticeHours} hours’ notice · checked automatically`, badge: 0 };
    case 'mine': { const n = reqs.filter((r) => r.subId === view.mySub.id && r.date >= site.today && (r.status === 'approved' || r.status === 'review')).length; return { title: def.title, sub: plural(n, 'upcoming delivery'), badge: 0 }; }
    case 'messages': return { title: def.title, sub: plural(view.mail.length, 'message'), badge: 0 };
    case 'receive': return { title: def.title, sub: 'Scan a gate pass', badge: 0 };
    case 'today': case 'overview': return { title: def.title, sub: `${plural(todayN, 'delivery', 'deliveries')} expected ${fmtDate(site.today)}`, badge: 0 };
    case 'gatelog': { const n = view.gatelog.filter((l) => site.dayOf(l.ts) === site.today).length; return { title: def.title, sub: plural(n, 'entry') + ' today', badge: 0 }; }
    case 'approvals': { const j = view.joinreqs.length; const rv = reqs.filter((r) => r.status === 'review').length; return { title: def.title, sub: `${plural(j, 'join request')} · ${plural(rv, 'delivery', 'deliveries')} to review`, badge: j + rv }; }
    case 'team': { const i = view.invites.length; return { title: def.title, sub: `${plural(view.members.length, 'member')}${i ? ' · ' + plural(i, 'invite') + ' pending' : ''}`, badge: 0 }; }
    case 'deliveries': return { title: def.title, sub: `${plural(reqs.length, 'request')} on this project`, badge: 0 };
    case 'emergency': return { title: def.title, sub: 'Same-day override, logged', badge: 0 };
    case 'activity': return { title: def.title, sub: 'Gate log and messages sent', badge: 0 };
    case 'psettings': return { title: def.title, sub: 'Code, gates, zones and rules', badge: 0 };
    default: void me; return { title: def.title, sub: '', badge: 0 };
  }
}

function Tab({ def, open, onToggle }: { def: TabDef; open: boolean; onToggle: () => void }) {
  const { title, sub, badge } = useTabHead(def.id);
  const app = useApp();
  const Panel = def.Panel;
  return (
    <section className="tab" id={'tab-' + def.id}>
      <div className="tab-bar">
        <button className="tab-btn" onClick={onToggle} aria-expanded={open} aria-controls={'panel-' + def.id}>
          <span className="tab-ic">{def.icon}</span>
          <span><span className="tab-title">{title}</span><span className="tab-sub">{sub}</span></span>
          <span>{badge ? <span className="badge warn">{badge}</span> : null}</span>
          {Icons.chev}
        </button>
        {def.id === 'project' ? <button className="plus" onClick={() => app.setSheet('add')} aria-label="Add a project code"><span>{Icons.plus}</span></button> : null}
      </div>
      {open ? <div className="tab-panel" id={'panel-' + def.id}>{app.view || def.id === 'project' ? <Panel /> : <p className="empty">Add a project first.</p>}</div> : null}
    </section>
  );
}

export function Home() {
  const app = useApp();
  const { home, role, pid, maint } = app;
  const tabs = useMemo(() => tabsFor(role), [role]);
  const key = pid + ':' + role;
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [openKey, setOpenKey] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [gate, setGate] = useState<GateState>({});

  useEffect(() => {
    if (openKey === key) return;
    setOpenKey(key); setEditing(null); setGate({});
    setOpen(pid && tabs[1] ? { [tabs[1].id]: true } : { project: true });
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const homeState: HomeState = {
    openTab(id) {
      setOpen((o) => Object.assign({}, o, { [id]: true }));
      setTimeout(() => document.getElementById('tab-' + id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    },
    editing, setEditing, gate, setGate,
    async runCheck(code, source) {
      if (!app.pid) return;
      setGate({ busy: true, source });
      try {
        const res = await app.api.checkGate(app.pid, code);
        setGate({ res, source });
      } catch (e) { setGate({ error: e instanceof Error ? e.message : 'Check failed.' }); }
      setOpen((o) => Object.assign({}, o, { receive: true }));
      setTimeout(() => document.getElementById('gResult')?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 50);
    },
  };

  if (!home) return <div className="center"><span className="spinner" aria-label="Loading" /></div>;
  const me = home.me;
  return (
    <HomeCtx.Provider value={homeState}>
      <header className="hdr">
        <div className="hdr-name">{me.first} {me.last}</div>
        <div className="hdr-co">{me.company}</div>
        <button className="iconbtn gear" onClick={() => app.setSheet('settings')} aria-label="Settings">{Icons.gear}</button>
      </header>
      {maint.on && app.view?.canMaintain ? (
        <div className="maintbar" role="region" aria-label="Maintenance mode">
          <span className="mlabel">Maintenance mode · viewing as</span>
          <div className="seg" role="group" aria-label="View as">
            {(['admin', 'contractor', 'access'] as Role[]).map((x) => (
              <button key={x} aria-pressed={maint.as === x} onClick={() => { app.setMaint({ on: true, as: x }); app.toast('Viewing as ' + roleLabel(x) + '.'); }}>{roleLabel(x)}</button>
            ))}
          </div>
        </div>
      ) : null}
      <main className="tabs">
        {tabs.map((t) => <Tab key={pid + ':' + t.id} def={t} open={!!open[t.id]} onToggle={() => setOpen((o) => Object.assign({}, o, { [t.id]: !o[t.id] }))} />)}
      </main>
      <p className="modebar">{app.api.mode === 'demo' ? 'Demo · data kept on this device' : ''}</p>
      {app.sheet === 'add' ? <AddProjectSheet /> : null}
      {app.sheet === 'settings' ? <SettingsSheet /> : null}
    </HomeCtx.Provider>
  );
}
