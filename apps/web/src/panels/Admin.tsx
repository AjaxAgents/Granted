import { fmtDate, fmtTime, slotsForDay, type Activity, type Gate, type Role, type Zone } from '@granted/core';
import { TRADES, type DeliveryRequest, type JoinView } from '@granted/services';
import { useState, type FormEvent } from 'react';
import { byWhen, initials, plural, roleLabel } from '../lib/format';
import { useApp } from '../state';
import { ConfirmButton, Field, Seg } from '../ui/components';
import { DeliveryRow, MailList, Reasons } from './Contractor';
import { GateLogTable, TodayList } from './Gate';

const ROLE_OPTS: [Role, string][] = [['contractor', 'Contractor'], ['access', 'Access Control'], ['admin', 'Admin']];

export function OverviewPanel() {
  const { view, site } = useApp();
  if (!view || !site) return null;
  const todays = view.requests.filter((r) => r.date === site.today && r.status === 'approved');
  const st = todays.map(site.statusOf);
  const red = view.gatelog.filter((l) => l.color === 'red' && site.dayOf(l.ts) === site.today).length;
  const need = view.requests.filter((r) => r.status === 'review').length + view.joinreqs.length;
  const tile = (n: number, l: string, cls = '') => <div className={'tile ' + cls}><div className="n">{n}</div><div className="l">{l}</div></div>;
  return (
    <>
      <div className="tiles">
        {tile(todays.length, 'Expected')}{tile(st.filter((x) => x === 'arrived').length, 'Arrived', 'grey')}{tile(red, 'Turned away', 'bad')}
        {tile(st.filter((x) => x === 'noshow').length, 'No-shows', 'bad')}{tile(need, 'Need approval', 'warn')}{tile(view.members.length, 'Members')}
      </div>
      <span className="eyebrow">Expected {fmtDate(site.today)}</span>
      <TodayList />
    </>
  );
}

function JoinCard({ j }: { j: JoinView }) {
  const app = useApp();
  const [role, setRole] = useState<Role>('contractor');
  const [trade, setTrade] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    const ok = await app.run(() => app.api.decideJoin(j.id, approve, role, trade), approve ? `${j.name} added as ${roleLabel(role)}.` : 'Request declined.');
    setBusy(false); if (ok !== undefined) await app.refresh();
  };
  return (
    <div className="card stack-s">
      <div className="person" style={{ padding: 0 }}><span className="avatar">{initials(j.name)}</span>
        <span><b>{j.name}</b><span className="isub" style={{ display: 'block' }}>{j.company}{j.isAjax ? ' · Ajax' : ''}</span><span className="isub" style={{ display: 'block' }}>{j.email} · {j.phone} · asked {app.site?.label(j.at)}</span></span><span />
      </div>
      <div className="grid2">
        <Field id={'jr_' + j.id} label="Access"><select id={'jr_' + j.id} value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
        <Field id={'jt_' + j.id} label="Trade (contractors)"><select id={'jt_' + j.id} value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">Any trade</option>{TRADES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
      </div>
      <div className="row"><button className="btn primary sm" disabled={busy} onClick={() => decide(true)}>Approve</button><button className="btn sm" disabled={busy} onClick={() => decide(false)}>Decline</button></div>
    </div>
  );
}

function ReviewCard({ r }: { r: DeliveryRequest }) {
  const app = useApp();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const decide = async (approve: boolean) => {
    setBusy(true);
    const ok = await app.run(() => app.api.decideRequest(r.id, approve, note), approve ? 'Approved. The pass went to the contractor and Access Control.' : 'Rejected. The contractor was told why.');
    setBusy(false); if (ok) await app.refresh();
  };
  return (
    <div className="card stack-s">
      <div className="between"><b>{r.subName}</b><span className="mono small">{fmtDate(r.date)} {fmtTime(r.slot)}</span></div>
      <span className="small">{r.material} · {plural(r.pallets, 'pallet')} · {app.site?.zone(r.zoneId).name}</span>
      <Reasons r={r} />
      {r.justification ? <span className="small"><b>Reason given:</b> {r.justification}</span> : null}
      <Field id={'rn_' + r.id} label="Note to contractor (optional)"><input id={'rn_' + r.id} autoComplete="off" maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
      <div className="row"><button className="btn go sm" disabled={busy} onClick={() => decide(true)}>Approve and issue pass</button><button className="btn sm" disabled={busy} onClick={() => decide(false)}>Reject</button></div>
    </div>
  );
}

export function ApprovalsPanel() {
  const { view } = useApp();
  if (!view) return null;
  const revs = view.requests.filter((r) => r.status === 'review').sort(byWhen);
  return (
    <>
      <span className="eyebrow">People asking to join ({view.joinreqs.length})</span>
      {view.joinreqs.length ? view.joinreqs.map((j) => <JoinCard key={j.id} j={j} />) : <p className="small muted">No one is waiting.</p>}
      <span className="eyebrow" style={{ marginTop: 6 }}>Deliveries to review ({revs.length})</span>
      {revs.length ? revs.map((r) => <ReviewCard key={r.id} r={r} />) : <p className="small muted">Nothing to review. Requests that pass every rule are approved automatically.</p>}
    </>
  );
}

export function TeamPanel() {
  const app = useApp();
  const { view, home } = app;
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('contractor');
  const [trade, setTrade] = useState('');
  if (!view || !home) return null;
  const order: Record<Role, number> = { admin: 0, access: 1, contractor: 2 };
  const members = [...view.members].sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name));
  async function invite(e: FormEvent) {
    e.preventDefault();
    const ok = await app.run(() => app.api.invite(view!.project.id, email, role, trade), 'Invite sent to ' + email.trim() + '.');
    if (ok) { setEmail(''); await app.refresh(); }
  }
  return (
    <>
      <div className="card stack-s"><span className="h3">Invite someone</span>
        <p className="hint">They get an email. When they sign up or sign in with that email, they get this access automatically. Invites expire after 7 days.</p>
        <form className="stack-s" onSubmit={invite} noValidate>
          <Field id="iv_email" label="Email"><input id="iv_email" type="email" inputMode="email" autoCapitalize="off" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <div className="grid2">
            <Field id="iv_role" label="Access"><select id="iv_role" value={role} onChange={(e) => setRole(e.target.value as Role)}>{ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field id="iv_trade" label="Trade (contractors)"><select id="iv_trade" value={trade} onChange={(e) => setTrade(e.target.value)}><option value="">Any trade</option>{TRADES.map((t) => <option key={t} value={t}>{t}</option>)}</select></Field>
          </div>
          <button className="btn primary" type="submit">Send invite</button>
        </form>
      </div>
      {view.invites.length ? (
        <div className="card"><span className="eyebrow">Pending invites</span>
          {view.invites.map((i) => (
            <div className="person" key={i.id}><span className="avatar">@</span>
              <span><b>{i.email}</b><span className="isub" style={{ display: 'block' }}>{roleLabel(i.role)}{i.trade ? ' · ' + i.trade : ''} · sent {app.site?.label(i.at)}</span></span>
              <ConfirmButton label="Revoke" confirm="Confirm revoke" onConfirm={async () => { if (await app.run(() => app.api.revokeInvite(i.id), 'Invite revoked.') !== undefined) await app.refresh(); }} />
            </div>
          ))}
        </div>
      ) : null}
      <div className="card"><span className="eyebrow">Members ({members.length})</span>
        {members.map((m) => {
          const self = m.userId === home.me.id;
          return (
            <div className="person" key={m.id}><span className="avatar">{initials(m.name)}</span>
              <span><b>{m.name}{self ? ' (you)' : ''}</b><span className="isub" style={{ display: 'block' }}>{m.company} · {m.email}{m.trade ? ' · ' + m.trade : ''}</span></span>
              <span className="stack-s" style={{ alignItems: 'flex-end' }}>
                <select aria-label={'Access for ' + m.name} value={m.role} disabled={self} style={{ minHeight: 36, padding: '4px 8px', fontSize: 13, width: 'auto' }}
                  onChange={async (e) => { const r = e.target.value as Role; if (await app.run(() => app.api.changeRole(m.id, r), `${m.name} is now ${roleLabel(r)}.`) !== undefined) await app.refresh(); }}>
                  {ROLE_OPTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {self ? null : <ConfirmButton label="Remove" confirm="Confirm remove" onConfirm={async () => { if (await app.run(() => app.api.removeMember(m.id), m.name + ' removed.') !== undefined) await app.refresh(); }} />}
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}

export function DeliveriesPanel() {
  const { view, site } = useApp();
  const [filter, setFilter] = useState<'today' | 'upcoming' | 'all'>('today');
  const [open, setOpen] = useState<string | null>(null);
  if (!view || !site) return null;
  let list = view.requests;
  if (filter === 'today') list = list.filter((r) => r.date === site.today); else if (filter === 'upcoming') list = list.filter((r) => r.date > site.today);
  list = [...list].sort(byWhen);
  return (
    <>
      <Seg value={filter} onChange={setFilter} label="Filter" options={[['today', 'Today'], ['upcoming', 'Upcoming'], ['all', 'All']]} />
      {list.length ? (
        <div className="list">{list.map((r) => (
          <div key={r.id} className="stack-s">
            <DeliveryRow r={r} site={site} open={open === r.id} onClick={() => setOpen(open === r.id ? null : r.id)} />
            {open === r.id ? (
              <div className="card stack-s" style={{ marginTop: -4 }}>
                <dl className="kv"><dt>Company</dt><dd>{r.subName}</dd><dt>Booked by</dt><dd>{r.submittedBy}{r.submitterEmail ? ' · ' + r.submitterEmail : ''}</dd><dt>Load</dt><dd>{r.quantity} {r.unit} · {plural(r.pallets, 'pallet')}</dd><dt>Decided</dt><dd>{r.decidedBy || ''}</dd></dl>
                <Reasons r={r} />
              </div>
            ) : null}
          </div>
        ))}</div>
      ) : <p className="empty">No deliveries in this view.</p>}
    </>
  );
}

export function EmergencyPanel() {
  const app = useApp();
  const { view } = app;
  const slots = view ? slotsForDay(view.project.settings) : [];
  const [f, setF] = useState({ subId: '', material: '', gateId: '', slot: '', zoneId: '', pallets: '1' });
  const [out, setOut] = useState('');
  if (!view) return null;
  const p = view.project;
  const v = { subId: f.subId || (view.subs[0] ? view.subs[0].id : ''), gateId: f.gateId || (p.gates[0] ? p.gates[0].id : ''), slot: f.slot || slots[0] || '', zoneId: f.zoneId || (p.zones[0] ? p.zones[0].id : '') };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!view!.subs.length) { app.toast('No companies on this project yet.'); return; }
    if (!f.material.trim()) { app.toast('Enter what the truck is carrying.'); return; }
    const r = await app.run(() => app.api.emergencyPass(p.id, { subId: v.subId, material: f.material, gateId: v.gateId, slot: v.slot, zoneId: v.zoneId, pallets: parseInt(f.pallets, 10) || 0 }));
    if (r) { setOut(`Pass ${r.passCode} issued for today ${fmtTime(r.slot)}. Access Control and ${r.subName} were told.`); setF(Object.assign({}, f, { material: '' })); await app.refresh(); }
  }
  const set = (k: keyof typeof f, val: string) => setF(Object.assign({}, f, { [k]: val }));
  return (
    <>
      <p className="hint">For a truck that has to get in today without a booking. Skips the rules, is marked as an override and counts against the company.</p>
      <form className="stack-s" onSubmit={submit} noValidate>
        <Field id="e_sub" label="Company"><select id="e_sub" value={v.subId} onChange={(e) => set('subId', e.target.value)}>{view.subs.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field id="e_material" label="Material"><input id="e_material" placeholder="e.g. Replacement breaker" autoComplete="off" maxLength={120} value={f.material} onChange={(e) => set('material', e.target.value)} /></Field>
        <div className="grid2">
          <Field id="e_gate" label="Gate"><select id="e_gate" value={v.gateId} onChange={(e) => set('gateId', e.target.value)}>{p.gates.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</select></Field>
          <Field id="e_slot" label="Today at"><select id="e_slot" value={v.slot} onChange={(e) => set('slot', e.target.value)}>{slots.map((s) => <option key={s} value={s}>{fmtTime(s)}</option>)}</select></Field>
          <Field id="e_zone" label="Staging"><select id="e_zone" value={v.zoneId} onChange={(e) => set('zoneId', e.target.value)}>{p.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select></Field>
          <Field id="e_pallets" label="Pallets"><input id="e_pallets" inputMode="numeric" value={f.pallets} onChange={(e) => set('pallets', e.target.value)} /></Field>
        </div>
        <button className="btn primary" type="submit">Issue emergency pass</button>
        {out ? <div className="note">{out}</div> : null}
      </form>
    </>
  );
}

export function ActivityPanel() {
  const app = useApp();
  const { view } = app;
  if (!view) return null;
  return (
    <>
      <div className="row"><button className="btn sm" onClick={async () => { const n = await app.run(() => app.api.noShowSweep(view.project.id), (k) => (k ? `${plural(k, 'no-show')} found. Contractor and admins emailed.` : 'No new no-shows.')); if (n !== undefined) await app.refresh(); }}>Run the no-show check now</button></div>
      <span className="eyebrow">Gate log</span>
      <GateLogTable all />
      <span className="eyebrow">Emails sent on this project ({view.mail.length})</span>
      {view.mail.length ? <MailList items={view.mail.slice(0, 60)} showTo /> : <p className="empty">No emails yet.</p>}
    </>
  );
}

/** Parses a look-ahead CSV: ID, Activity, Trade, Start, Finish (dates as YYYY-MM-DD or M/D/YYYY). */
export function parseLookahead(text: string): Activity[] {
  const rows = text.split(/\r?\n/).map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))).filter((r) => r.length >= 5 && r[0]);
  const date = (s: string) => { const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : s; };
  const body = /^id$/i.test(rows[0]?.[0] || '') || /activity/i.test(rows[0]?.[1] || '') ? rows.slice(1) : rows;
  return body.map((r) => ({ id: r[0], name: r[1], trade: r[2], start: date(r[3]), finish: date(r[4]) }));
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ProjectSettingsPanel() {
  const app = useApp();
  const { view, home } = app;
  const p = view?.project;
  const [d, setD] = useState(() => p ? {
    name: p.name, location: p.location, timeZone: p.timeZone,
    minNoticeHours: String(p.settings.minNoticeHours), maxDaysBeforeInstall: String(p.settings.maxDaysBeforeInstall), gateToleranceMinutes: String(p.settings.gateToleranceMinutes),
    maxPalletsPerRequest: String(p.settings.maxPalletsPerRequest), gateOpen: p.settings.gateOpen, gateClose: p.settings.gateClose, workDays: [...p.settings.workDays],
    gates: p.gates.map((g) => ({ ...g })) as Gate[], zones: p.zones.map((z) => ({ ...z })) as Zone[],
  } : null);
  const [confirmCode, setConfirmCode] = useState('');
  const [deleting, setDeleting] = useState(false);
  if (!view || !p || !d || !home) return null;
  const isAdminAccount = home.me.isAdminAccount;
  const n = (s: string) => Number(s);
  async function save(e: FormEvent) {
    e.preventDefault();
    const ok = await app.run(() => app.api.saveSettings(p!.id, {
      name: d!.name, location: d!.location, timeZone: d!.timeZone,
      settings: { minNoticeHours: n(d!.minNoticeHours), maxDaysBeforeInstall: n(d!.maxDaysBeforeInstall), gateToleranceMinutes: n(d!.gateToleranceMinutes), maxPalletsPerRequest: n(d!.maxPalletsPerRequest), gateOpen: d!.gateOpen, gateClose: d!.gateClose, workDays: d!.workDays },
      gates: d!.gates.map((g) => ({ id: g.id, name: g.name, capacityPerSlot: Number(g.capacityPerSlot) })), zones: d!.zones.map((z) => ({ id: z.id, name: z.name, capacityPallets: Number(z.capacityPallets) })),
    }), 'Project settings saved.');
    if (ok !== undefined) await app.refresh();
  }
  async function upload(file: File | undefined) {
    if (!file) return;
    const acts = parseLookahead(await file.text());
    const k = await app.run(() => app.api.replaceLookahead(p!.id, acts), (c) => `Look-ahead updated: ${plural(c, 'activity', 'activities')}.`);
    if (k !== undefined) await app.refresh();
  }
  const setG = (i: number, k: 'name' | 'capacityPerSlot', v: string) => setD(Object.assign({}, d, { gates: d.gates.map((g, j) => (j === i ? Object.assign({}, g, { [k]: k === 'name' ? v : Number(v) }) : g)) }));
  const setZ = (i: number, k: 'name' | 'capacityPallets', v: string) => setD(Object.assign({}, d, { zones: d.zones.map((z, j) => (j === i ? Object.assign({}, z, { [k]: k === 'name' ? v : Number(v) }) : z)) }));
  const tzs = ['America/Chicago', 'America/New_York', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu'];
  return (
    <>
      <form className="stack" onSubmit={save} noValidate>
        <div className="card stack-s"><span className="h3">Project</span>
          <Field id="ps_name" label="Name"><input id="ps_name" value={d.name} maxLength={80} onChange={(e) => setD(Object.assign({}, d, { name: e.target.value }))} /></Field>
          <Field id="ps_loc" label="Location"><input id="ps_loc" value={d.location} maxLength={120} onChange={(e) => setD(Object.assign({}, d, { location: e.target.value }))} /></Field>
          <Field id="ps_tz" label="Site time zone"><select id="ps_tz" value={d.timeZone} onChange={(e) => setD(Object.assign({}, d, { timeZone: e.target.value }))}>{(tzs.includes(d.timeZone) ? tzs : [d.timeZone, ...tzs]).map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></Field>
          <div className="row"><span className="code-chip">{p.code}</span>
            {isAdminAccount ? <ConfirmButton className="btn sm" label="New code" confirm="Replace code? Old code stops working" onConfirm={async () => { if (await app.run(() => app.api.regenerateCode(p.id), (c) => 'New project code: ' + c) !== undefined) await app.refresh(); }} /> : null}
          </div>
        </div>
        <div className="card stack-s"><span className="h3">Delivery rules</span>
          <div className="grid2">
            <Field id="ps_notice" label="Notice (hours)"><input id="ps_notice" inputMode="numeric" value={d.minNoticeHours} onChange={(e) => setD(Object.assign({}, d, { minNoticeHours: e.target.value }))} /></Field>
            <Field id="ps_early" label="Max days before install"><input id="ps_early" inputMode="numeric" value={d.maxDaysBeforeInstall} onChange={(e) => setD(Object.assign({}, d, { maxDaysBeforeInstall: e.target.value }))} /></Field>
            <Field id="ps_tol" label="Arrival window (± min)"><input id="ps_tol" inputMode="numeric" value={d.gateToleranceMinutes} onChange={(e) => setD(Object.assign({}, d, { gateToleranceMinutes: e.target.value }))} /></Field>
            <Field id="ps_pal" label="Review above (pallets)"><input id="ps_pal" inputMode="numeric" value={d.maxPalletsPerRequest} onChange={(e) => setD(Object.assign({}, d, { maxPalletsPerRequest: e.target.value }))} /></Field>
            <Field id="ps_open" label="Gates open"><input id="ps_open" type="time" value={d.gateOpen} onChange={(e) => setD(Object.assign({}, d, { gateOpen: e.target.value }))} /></Field>
            <Field id="ps_close" label="Gates close"><input id="ps_close" type="time" value={d.gateClose} onChange={(e) => setD(Object.assign({}, d, { gateClose: e.target.value }))} /></Field>
          </div>
          <div className="field"><span className="label">Delivery days</span>
            <div className="chips" role="group" aria-label="Delivery days">{DAY.map((x, i) => (
              <button key={x} type="button" className="chip" aria-pressed={d.workDays.includes(i)} onClick={() => setD(Object.assign({}, d, { workDays: d.workDays.includes(i) ? d.workDays.filter((k) => k !== i) : [...d.workDays, i].sort() }))}>{x}</button>
            ))}</div>
          </div>
        </div>
        <div className="card stack-s"><span className="h3">Gates (name · trucks per slot)</span>
          {d.gates.map((g, i) => <div className="grid2" key={g.id}><input aria-label={'Gate ' + (i + 1) + ' name'} value={g.name} maxLength={60} onChange={(e) => setG(i, 'name', e.target.value)} /><input aria-label={g.name + ' trucks per slot'} inputMode="numeric" value={String(g.capacityPerSlot)} onChange={(e) => setG(i, 'capacityPerSlot', e.target.value)} /></div>)}
          <button type="button" className="btn sm" onClick={() => setD(Object.assign({}, d, { gates: [...d.gates, { id: 'G' + (d.gates.length + 1) + '-' + Date.now().toString(36).slice(-3).toUpperCase(), name: 'New gate', capacityPerSlot: 1 }] }))}>Add a gate</button>
        </div>
        <div className="card stack-s"><span className="h3">Staging zones (name · pallets)</span>
          {d.zones.map((z, i) => <div className="grid2" key={z.id}><input aria-label={'Zone ' + (i + 1) + ' name'} value={z.name} maxLength={60} onChange={(e) => setZ(i, 'name', e.target.value)} /><input aria-label={z.name + ' pallets'} inputMode="numeric" value={String(z.capacityPallets)} onChange={(e) => setZ(i, 'capacityPallets', e.target.value)} /></div>)}
          <button type="button" className="btn sm" onClick={() => setD(Object.assign({}, d, { zones: [...d.zones, { id: 'Z' + (d.zones.length + 1) + '-' + Date.now().toString(36).slice(-3).toUpperCase(), name: 'New zone', capacityPallets: 10 }] }))}>Add a zone</button>
        </div>
        <button className="btn primary" type="submit">Save project settings</button>
      </form>
      <div className="card stack-s"><span className="h3">Companies</span>
        <p className="hint">Suspending a company rejects its new requests and turns its passes red, except emergency passes.</p>
        {view.subs.length ? view.subs.map((x) => (
          <div className="between" key={x.id} style={{ borderTop: '1px solid var(--g-100)', paddingTop: 8 }}>
            <span><b>{x.name}</b><span className="isub" style={{ display: 'block' }}>{x.trade || 'Any trade'}</span></span>
            <button className="btn sm" onClick={async () => { if (await app.run(() => app.api.setSuspended(p.id, x.id, !x.suspended), x.suspended ? 'Company restored.' : 'Company suspended.') !== undefined) await app.refresh(); }}>{x.suspended ? 'Restore' : 'Suspend'}</button>
          </div>
        )) : <p className="small muted">No companies yet.</p>}
      </div>
      <div className="card stack-s"><span className="h3">Look-ahead ({p.activities.length} activities)</span>
        <p className="hint">Upload the 3-week look-ahead each week as a CSV with columns ID, Activity, Trade, Start, Finish. It replaces the current list.</p>
        <label className="btn sm" style={{ alignSelf: 'flex-start' }}>Upload CSV<input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {p.activities.length ? (
          <div className="table-wrap"><table style={{ minWidth: 420 }}><thead><tr><th>ID</th><th>Activity</th><th>Trade</th><th>Start</th><th>Finish</th></tr></thead>
            <tbody>{p.activities.map((a) => <tr key={a.id}><td className="mono">{a.id}</td><td>{a.name}</td><td>{a.trade}</td><td className="mono">{fmtDate(a.start)}</td><td className="mono">{fmtDate(a.finish)}</td></tr>)}</tbody></table></div>
        ) : null}
      </div>
      {isAdminAccount ? (
        <div className="card stack-s"><span className="h3 danger">Delete project</span>
          <p className="hint">Removes {p.name} for everyone. Records are kept for audit.</p>
          {deleting ? (
            <div className="stack-s">
              <label className="small" htmlFor="delConfirm">Type the project code <b className="mono">{p.code}</b> to confirm</label>
              <input id="delConfirm" className="mono" autoComplete="off" value={confirmCode} onChange={(e) => setConfirmCode(e.target.value)} />
              <button className="btn sm stop" onClick={async () => { if (await app.run(() => app.api.deleteProject(p.id, confirmCode), 'Project deleted.') !== undefined) { app.setPid(null); await app.refresh(); } }}>Delete project</button>
            </div>
          ) : <button className="btn sm ghost danger" style={{ alignSelf: 'flex-start' }} onClick={() => setDeleting(true)}>Delete this project</button>}
        </div>
      ) : null}
    </>
  );
}
