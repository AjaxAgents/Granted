import { fmtDate, fmtTime } from '@granted/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { byWhen, plural } from '../lib/format';
import { canUseLiveCamera, decodeFrame, decodeImageFile, scanNative } from '../lib/scanner';
import { isNative } from '../lib/storage';
import { useApp } from '../state';
import { useHome } from '../screens/Home';
import { Icons, Pill } from '../ui/components';

/** Live camera scanner for the web: decodes frames until it finds a QR code. */
function LiveScanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: (error?: string) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    let stream: MediaStream | null = null; let raf = 0; let done = false;
    const canvas = document.createElement('canvas');
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
        const v = video.current; if (!v) return;
        v.srcObject = stream; v.setAttribute('playsinline', 'true'); await v.play();
        const loop = () => {
          if (done) return;
          if (v.readyState >= 2 && v.videoWidth) {
            const k = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
            const code = decodeFrame(v, Math.round(v.videoWidth * k), Math.round(v.videoHeight * k), canvas);
            if (code) { done = true; onCode(code); return; }
          }
          raf = requestAnimationFrame(loop);
        };
        loop();
      } catch {
        onClose('The camera isn’t available. Allow camera access, or take a photo or type the code.');
      }
    })();
    return () => { done = true; cancelAnimationFrame(raf); if (stream) stream.getTracks().forEach((t) => t.stop()); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="live">
      <video ref={video} muted playsInline aria-label="Camera view" />
      <div className="frame" aria-hidden="true" />
      <button className="iconbtn close" onClick={() => onClose()} aria-label="Stop scanning">{Icons.close}</button>
    </div>
  );
}

function Verdict() {
  const app = useApp(); const home = useHome();
  const { view, site } = app;
  const g = home.gate;
  const [busy, setBusy] = useState(false);
  if (!view || !site) return null;
  if (g.busy) return <div className="center"><span className="spinner" aria-label="Checking" /></div>;
  if (g.error) return <div className="card"><b>{g.error}</b></div>;
  if (!g.res) return null;
  const res = g.res; const r = res.request; const green = res.color === 'green';
  const act = async (kind: 'admit' | 'turnAway') => {
    setBusy(true);
    const out = await app.run(() => (kind === 'admit' ? app.api.admit(view.project.id, res.code) : app.api.turnAway(view.project.id, res.code)));
    setBusy(false);
    if (out) { home.setGate(Object.assign({}, g, { logged: out.message })); await app.refresh(); }
  };
  return (
    <div className={'verdict ' + res.color} role="alert">
      <div className="meta">{res.code} · {site.clock(res.at)}{g.source === 'photo' ? ' · from photo' : ''}{view.maintenance ? ' · maintenance' : ''}</div>
      <div className="big">{green ? 'Admit' : 'Turn away'}</div>
      <div className="why">{res.title}</div>
      <div><b>{green ? 'Next: ' : 'What has to happen: '}</b>{res.remedy}</div>
      {r ? (
        <dl className="kv">
          <dt>Company</dt><dd>{r.subName}</dd>
          <dt>Load</dt><dd>{r.material} ({r.quantity} {r.unit}, {plural(r.pallets, 'pallet')})</dd>
          <dt>Booked</dt><dd>{fmtDate(r.date)} {fmtTime(r.slot)} · arrive {r.windowOpen}–{r.windowClose}</dd>
          <dt>Gate</dt><dd>{site.gate(r.gateId).name}</dd>
          <dt>Staging</dt><dd>{site.zone(r.zoneId).name}</dd>
          <dt>Contact</dt><dd>{r.pocName}{r.pocPhone ? ', ' + r.pocPhone : ''}</dd>
        </dl>
      ) : null}
      {g.logged ? <div className="logged">{g.logged}</div> : (
        <div className="row">
          {green ? <button className="btn" disabled={busy} onClick={() => act('admit')}>Admit and log</button> : <button className="btn" disabled={busy} onClick={() => act('turnAway')}>Log turn-away and notify</button>}
          <button className="btn ghost" onClick={() => home.setGate({})}>Clear</button>
        </div>
      )}
    </div>
  );
}

export function ReceivePanel() {
  const app = useApp(); const home = useHome();
  const [code, setCode] = useState('');
  const [live, setLive] = useState(false);
  const photo = useRef<HTMLInputElement>(null);
  if (!app.view || !app.site) return null;

  async function scan() {
    if (isNative()) { const c = await scanNative(); if (c) await home.runCheck(c, 'camera'); return; }
    if (canUseLiveCamera()) { home.setGate({}); setLive(true); return; }
    photo.current?.click();
  }
  async function onPhoto(file: File | undefined) {
    if (!file) return;
    home.setGate({ busy: true });
    const out = await decodeImageFile(file);
    if (out.data) await home.runCheck(out.data, 'photo'); else home.setGate({ error: out.error });
  }
  function typed(e: FormEvent) {
    e.preventDefault();
    const v = code.trim(); if (!v) { app.toast('Type a pass code first.'); return; }
    setCode(''); home.runCheck(v, 'typed');
  }
  return (
    <>
      {live ? (
        <LiveScanner onCode={(c) => { setLive(false); home.runCheck(c, 'camera'); }} onClose={(err) => { setLive(false); if (err) home.setGate({ error: err }); }} />
      ) : (
        <button className="btn primary block scanbtn" onClick={scan}>{Icons.scan} Scan QR code</button>
      )}
      <input ref={photo} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(e) => { onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      <form className="codeform" onSubmit={typed}>
        <label className="sr-only" htmlFor="codeIn">Pass code</label>
        <input id="codeIn" placeholder="Or type the code" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={code} onChange={(e) => setCode(e.target.value)} />
        <button className="btn" type="submit">Check</button>
      </form>
      <p className="hint">
        {!isNative() ? <><button type="button" className="link-grey" style={{ padding: 0 }} onClick={() => photo.current?.click()}>Use a photo instead</button> · </> : null}
        Gate time: <b>{fmtDate(app.site.today)} {app.site.clock(app.api.now().toISOString())}</b>{app.api.demo && app.api.demo.clockMode() !== 'live' ? ' (demo clock)' : ''}
      </p>
      <div id="gResult" aria-live="polite"><Verdict /></div>
    </>
  );
}

export function TodayList() {
  const { view, site } = useApp(); const home = useHome();
  if (!view || !site) return null;
  const list = view.requests.filter((r) => r.date === site.today && (r.status === 'approved' || r.status === 'cancelled')).sort(byWhen);
  if (!list.length) return <p className="empty">No deliveries booked for today.</p>;
  return (
    <div className="list">
      {list.map((r) => {
        const st = site.statusOf(r);
        return (
          <div className="item" key={r.id} style={{ gridTemplateColumns: '62px minmax(0,1fr)' }}>
            <span className="when">{fmtTime(r.slot)}<span>{r.gateId}</span></span>
            <span className="stack-s" style={{ gap: 4 }}>
              <span className="ititle">{r.subName}</span>
              <span className="isub">{r.material}{r.passCode ? <> · <span className="mono">{r.passCode}</span></> : null}</span>
              <span className="row" style={{ gap: 8 }}><Pill st={st} />{r.passCode && st === 'approved' ? <button className="btn sm" onClick={() => home.runCheck(r.passCode as string, 'list')}>Check at gate</button> : null}</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
export function TodayPanel() { return <TodayList />; }

export function GateLogTable({ all }: { all: boolean }) {
  const { view, site } = useApp();
  if (!view || !site) return null;
  const log = view.gatelog.filter((l) => all || site.dayOf(l.ts) === site.today).sort((a, b) => b.ts.localeCompare(a.ts));
  if (!log.length) return <p className="empty">Nothing logged yet.</p>;
  return (
    <div className="table-wrap"><table>
      <thead><tr><th>Time</th><th>Result</th><th>Code</th><th>Reason</th><th>By</th></tr></thead>
      <tbody>{log.map((l) => (
        <tr key={l.id}><td className="mono">{all ? site.label(l.ts) : site.clock(l.ts)}</td><td><Pill st={l.color === 'green' ? 'green' : 'red'}>{l.action === 'admitted' ? 'Admitted' : 'Turned away'}</Pill></td><td className="mono">{l.code}</td><td>{l.title}</td><td>{l.guard}</td></tr>
      ))}</tbody>
    </table></div>
  );
}
export function GateLogPanel() { return <GateLogTable all={false} />; }
