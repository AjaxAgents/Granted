import { roleLabel } from '../lib/format';
import { useApp } from '../state';
import { Icons, Pill } from '../ui/components';

export function ProjectPanel() {
  const app = useApp();
  const { home, view, role } = app;
  if (!home) return null;
  const pending = home.pending;
  const copy = async (text: string) => { try { await navigator.clipboard.writeText(text); app.toast('Copied ' + text + '.'); } catch { app.toast('Code: ' + text); } };
  const Pending = () => pending.length ? (
    <div className="card stack-s"><span className="eyebrow">Waiting for approval</span>
      {pending.map((x) => <div className="between" key={x.projectId}><b>{x.name}</b><Pill st="pending">Pending</Pill></div>)}
    </div>
  ) : null;

  if (!view) {
    return (
      <>
        <div className="empty"><b>You’re not on a project yet.</b>
          <span>Tap <b>+</b> and enter the project code from your project admin.{home.me.isAdminAccount ? ' As an Ajax admin you can also create a new project.' : ''}</span>
          <button className="btn primary" onClick={() => app.setSheet('add')}>{home.me.isAdminAccount ? 'Add or create a project' : 'Enter a project code'}</button>
        </div>
        <Pending />
      </>
    );
  }
  const p = view.project;
  return (
    <>
      <div className="card stack">
        <div className="between">
          <div className="stack-s" style={{ gap: 2 }}><span className="eyebrow">Current project</span><span className="h3">{p.name}</span>{p.location ? <span className="small muted">{p.location}</span> : null}</div>
          <Pill st={role === 'admin' ? 'approved' : 'arrived'}>{roleLabel(role)}</Pill>
        </div>
        <div className="row"><span className="code-chip" aria-label="Project code">{p.code}</span><button className="btn sm" onClick={() => copy(p.code)}>Copy code</button></div>
        <p className="hint">Everyone on this project uses this code to join. Admins approve each person and choose their access.</p>
      </div>
      {home.projects.length > 1 ? (
        <div className="stack-s"><span className="eyebrow">Switch project</span>
          <div className="list">
            {home.projects.map((x) => (
              <button key={x.id} className="item" style={{ gridTemplateColumns: 'minmax(0,1fr) auto' }} aria-current={x.id === p.id || undefined}
                onClick={() => { app.setPid(x.id); app.toast('Switched to ' + x.name + '.'); }}>
                <span><span className="ititle">{x.name}</span><span className="isub" style={{ display: 'block' }}>{roleLabel(x.role)} · {x.code}</span></span>
                {x.id === p.id ? <Pill st="approved">Open</Pill> : <span className="small muted">Switch</span>}
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <Pending />
      <button className="btn" onClick={() => app.setSheet('add')}><span style={{ width: 18, height: 18, display: 'inline-flex' }}>{Icons.plus}</span> {home.me.isAdminAccount ? 'Add or create a project' : 'Add a project code'}</button>
    </>
  );
}
