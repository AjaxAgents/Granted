import { fmtClock, fmtDate, isValidPhone, toWallClock, ymd } from '@granted/core';
import { DEMO_TZ } from '@granted/services';
import { useEffect, useState, type FormEvent } from 'react';
import { roleLabel } from '../lib/format';
import { useApp } from '../state';
import { ConfirmButton, Field, PasswordInput, PwRules, Seg, Sheet } from '../ui/components';
import { MailList } from '../panels/Contractor';

export function AddProjectSheet() {
  const app = useApp();
  const me = app.home!.me;
  const [mode, setMode] = useState<'join' | 'create'>('join');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [loc, setLoc] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<{ name: string; code: string } | null>(null);
  const close = () => app.setSheet(null);

  async function join(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await app.api.enterCode(code);
      if (r.projectId) app.setPid(r.projectId);
      close(); await app.refresh(); app.toast(r.message);
    } catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); } finally { setBusy(false); }
  }
  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) { setErr('Enter a project name.'); return; }
    setBusy(true); setErr('');
    try { const p = await app.api.createProject(name, loc); setCreated({ name: p.name, code: p.code }); app.setPid(p.id); await app.refresh(); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); } finally { setBusy(false); }
  }
  return (
    <Sheet title="Add a project" onClose={close}>
      {me.isAdminAccount ? <Seg value={mode} onChange={(m) => { setMode(m); setErr(''); }} label="Add a project" options={[['join', 'Join with a code'], ['create', 'Create a project']]} /> : null}
      {mode === 'join' ? (
        <form className="stack-s" onSubmit={join} noValidate>
          <Field id="jp_code" label="Project code" hint="Your request goes to the project admins. They choose your access.">
            <input id="jp_code" className="mono" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="e.g. DDC2-7HKQ" value={code} onChange={(e) => setCode(e.target.value)} autoFocus />
          </Field>
          {err ? <p className="err">{err}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>Send request</button>
        </form>
      ) : (
        <form className="stack-s" onSubmit={create} noValidate>
          <Field id="cp_name" label="Project name"><input id="cp_name" placeholder="e.g. DFW2 Data Center 2" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field id="cp_loc" label="Location (optional)"><input id="cp_loc" placeholder="City, state" maxLength={120} value={loc} onChange={(e) => setLoc(e.target.value)} /></Field>
          <p className="hint">A unique project code is created. You become the project admin and can invite people or approve requests.</p>
          {err ? <p className="err">{err}</p> : null}
          <button className="btn primary" type="submit" disabled={busy}>Create project</button>
        </form>
      )}
      {created ? <div className="note"><b>{created.name}</b> is ready. Project code <span className="mono"><b>{created.code}</b></span>. Share it, or invite people from Team &amp; Invites.</div> : null}
    </Sheet>
  );
}

type Sec = '' | 'profile' | 'pw' | 'projects' | 'mail' | 'demo' | 'delete';

export function SettingsSheet() {
  const app = useApp();
  const me = app.home!.me;
  const [sec, setSec] = useState<Sec>('');
  const toggle = (s: Sec) => setSec(sec === s ? '' : s);
  const canMaintain = !!app.view?.canMaintain;
  return (
    <Sheet title="Settings" onClose={() => app.setSheet(null)}>
      <div className="menu-list">
        <button className="menu-row" aria-expanded={sec === 'profile'} onClick={() => toggle('profile')}>Profile <span className="muted">{me.email}</span></button>
        {sec === 'profile' ? <Profile /> : null}
        <button className="menu-row" aria-expanded={sec === 'pw'} onClick={() => toggle('pw')}>Change password <span className="muted">›</span></button>
        {sec === 'pw' ? <ChangePassword done={() => setSec('')} /> : null}
        <button className="menu-row" aria-expanded={sec === 'projects'} onClick={() => toggle('projects')}>My projects <span className="muted">{app.home!.projects.length}</span></button>
        {sec === 'projects' ? (
          <div className="stack-s">
            {app.home!.projects.length ? app.home!.projects.map((p) => (
              <div className="between" key={p.id}>
                <span><b>{p.name}</b><span className="isub" style={{ display: 'block' }}>{roleLabel(p.role)} · {p.code}</span></span>
                <ConfirmButton label="Leave" confirm="Confirm leave" onConfirm={async () => { if (await app.run(() => app.api.leaveProject(p.id), 'You left the project.') !== undefined) { app.setSheet(null); await app.refresh(); } }} />
              </div>
            )) : <p className="small muted">No projects yet.</p>}
          </div>
        ) : null}
        {app.api.demo ? (
          <>
            <button className="menu-row" aria-expanded={sec === 'mail'} onClick={() => toggle('mail')}>Email inbox (demo) <span className="muted">›</span></button>
            {sec === 'mail' ? <Inbox email={me.email} /> : null}
          </>
        ) : null}
        {canMaintain ? (
          <div className="menu-row" style={{ cursor: 'default' }}>
            <span><span style={{ display: 'block' }}>Maintenance mode</span><span className="muted" style={{ display: 'block', fontWeight: 400, fontSize: 12.5 }}>See this project as a Contractor, Access Control or Admin. Anything you do is labelled as maintenance.</span></span>
            <label className="switch"><input type="checkbox" checked={app.maint.on} aria-label="Maintenance mode" onChange={(e) => { app.setMaint({ on: e.target.checked, as: 'admin' }); app.toast(e.target.checked ? 'Maintenance mode on. Pick a view under the header.' : 'Maintenance mode off.'); }} /><span /></label>
          </div>
        ) : null}
        {app.api.demo ? (
          <>
            <button className="menu-row" aria-expanded={sec === 'demo'} onClick={() => toggle('demo')}>Demo tools <span className="muted">Demo clock</span></button>
            {sec === 'demo' ? <DemoTools /> : null}
          </>
        ) : null}
        <div className="menu-row" style={{ cursor: 'default', fontWeight: 400 }}>
          <span className="links" style={{ justifyContent: 'flex-start' }}><a href="./privacy.html" target="_blank" rel="noopener">Privacy Policy</a><a href="./terms.html" target="_blank" rel="noopener">Terms of Use</a><a href="./support.html" target="_blank" rel="noopener">Support</a></span>
        </div>
        <button className="menu-row danger" onClick={() => app.signOut()}>Sign out</button>
        <button className="menu-row danger" style={{ fontWeight: 400, fontSize: 13.5 }} aria-expanded={sec === 'delete'} onClick={() => toggle('delete')}>Delete my account</button>
        {sec === 'delete' ? <DeleteAccount /> : null}
      </div>
    </Sheet>
  );
}

function Profile() {
  const app = useApp();
  const me = app.home!.me;
  const [f, setF] = useState({ first: me.first, last: me.last, phone: me.phone, company: me.company });
  async function save(e: FormEvent) {
    e.preventDefault();
    if (!f.first.trim() || !f.last.trim() || !f.company.trim() || !isValidPhone(f.phone)) { app.toast('Fill in every field with a 10-digit phone number.'); return; }
    if (await app.run(() => app.api.updateProfile(f), 'Profile saved.')) await app.refresh();
  }
  const set = (k: keyof typeof f, v: string) => setF(Object.assign({}, f, { [k]: v }));
  return (
    <form className="stack-s" onSubmit={save} noValidate>
      <div className="grid2">
        <Field id="pf_first" label="First name"><input id="pf_first" value={f.first} maxLength={60} onChange={(e) => set('first', e.target.value)} /></Field>
        <Field id="pf_last" label="Last name"><input id="pf_last" value={f.last} maxLength={60} onChange={(e) => set('last', e.target.value)} /></Field>
      </div>
      <Field id="pf_phone" label="Phone"><input id="pf_phone" inputMode="tel" value={f.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
      <Field id="pf_company" label="Company" hint="Your company decides which deliveries you can see on each project."><input id="pf_company" value={f.company} maxLength={100} onChange={(e) => set('company', e.target.value)} /></Field>
      <p className="hint">{me.isAjax ? 'Ajax Building Company account' : 'Non-Ajax account'}{me.isAdminAccount ? ' · Admin account (can create projects)' : ''}</p>
      <button className="btn primary" type="submit">Save profile</button>
    </form>
  );
}

function ChangePassword({ done }: { done: () => void }) {
  const app = useApp();
  const [cur, setCur] = useState(''); const [nw, setNw] = useState(''); const [err, setErr] = useState('');
  async function save(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { await app.api.changePassword(cur, nw); done(); app.toast('Password updated. Other devices were signed out.'); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); }
  }
  return (
    <form className="stack-s" onSubmit={save} noValidate>
      <Field id="pw_cur" label="Current password"><PasswordInput id="pw_cur" value={cur} onChange={setCur} autoComplete="current-password" /></Field>
      <Field id="pw_new" label="New password"><PasswordInput id="pw_new" value={nw} onChange={setNw} autoComplete="new-password" /><PwRules value={nw} /></Field>
      {err ? <p className="err">{err}</p> : null}
      <button className="btn primary" type="submit">Update password</button>
    </form>
  );
}

function DeleteAccount() {
  const app = useApp();
  const [pw, setPw] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  async function go(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { await app.api.deleteAccount(pw); app.setSheet(null); app.go('login'); app.toast('Your account was deleted.'); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); } finally { setBusy(false); }
  }
  return (
    <form className="stack-s" style={{ padding: '8px 0' }} onSubmit={go} noValidate>
      <span className="small">This permanently deletes your profile, sign-in and project access, and your messages. Delivery records stay on each project for safety and audit, without your name or contact details.</span>
      <Field id="del_pw" label="Your password"><PasswordInput id="del_pw" value={pw} onChange={setPw} autoComplete="current-password" /></Field>
      {err ? <p className="err">{err}</p> : null}
      <button className="btn sm stop" type="submit" disabled={busy}>Delete my account</button>
    </form>
  );
}

function Inbox({ email }: { email: string }) {
  const app = useApp();
  const [items, setItems] = useState<{ ts: string; subject: string; body: string; kind: string }[] | null>(null);
  useEffect(() => { app.api.demo?.inbox(email).then(setItems); }, [email]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!items) return null;
  return (
    <>
      <p className="hint">Every email Granted would send you: codes, invites, approvals and delivery notices.</p>
      {items.length ? <MailList items={items.slice(0, 40).map((m) => Object.assign({ to: email }, m))} /> : <p className="small muted">No emails yet.</p>}
    </>
  );
}

function DemoTools() {
  const app = useApp();
  const demo = app.api.demo!;
  const wall = toWallClock(app.api.now(), DEMO_TZ);
  const [date, setDate] = useState(ymd(wall));
  const [time, setTime] = useState(String(wall.getHours()).padStart(2, '0') + ':' + String(wall.getMinutes()).padStart(2, '0'));
  const after = async (msg: string) => { await app.refresh(); app.toast(msg); };
  return (
    <div className="stack-s">
      <p className="hint">The rules use this site time: <b>{fmtDate(ymd(wall))} {fmtClock(wall)}</b>. Try 5:45 AM (too early) or 7:15 AM (inside the window).</p>
      <div className="grid2">
        <Field id="clkDate" label="Date"><input type="date" id="clkDate" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field id="clkTime" label="Time"><input type="time" id="clkTime" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
      </div>
      <div className="row">
        <button className="btn sm primary" onClick={() => { if (!date || !time) return; demo.setClock(date, time); after('Clock set.'); }}>Set clock</button>
        <button className="btn sm" onClick={() => { demo.autoClock(); after('Demo clock: demo day, 7:15 AM.'); }}>Demo default</button>
        <button className="btn sm" onClick={() => { demo.liveClock(); after('Using real time.'); }}>Real time</button>
      </div>
      <ConfirmButton label="Reset demo data" confirm="Erase and reload the demo?" onConfirm={async () => { await demo.reset(); app.setSheet(null); app.go('login'); app.toast('Demo reset. Sign in with a demo account.'); }} />
    </div>
  );
}
