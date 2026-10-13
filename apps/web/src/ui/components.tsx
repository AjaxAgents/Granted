import { passwordChecks } from '@granted/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { LABEL } from '../lib/format';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
export const Icons = {
  gear: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="3.2" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  plus: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>,
  chev: <svg className="chev" viewBox="0 0 24 24" {...P} strokeWidth={2}><path d="M6 9l6 6 6-6" /></svg>,
  back: <svg viewBox="0 0 24 24" {...P} strokeWidth={2}><path d="M15 18l-6-6 6-6" /></svg>,
  close: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>,
  site: <svg viewBox="0 0 24 24" {...P}><path d="M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6" /></svg>,
  qr: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>,
  scan: <svg viewBox="0 0 24 24" {...P}><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3M7 12h10" /></svg>,
  cal: <svg viewBox="0 0 24 24" {...P}><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M8 14h3v3H8z" /></svg>,
  truck: <svg viewBox="0 0 24 24" {...P}><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.8" /><circle cx="17" cy="18" r="1.8" /></svg>,
  inbox: <svg viewBox="0 0 24 24" {...P}><path d="M4 4h16v16H4zM4 13h4l2 3h4l2-3h4" /></svg>,
  list: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" /></svg>,
  log: <svg viewBox="0 0 24 24" {...P}><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" /></svg>,
  check: <svg viewBox="0 0 24 24" {...P}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" /></svg>,
  users: <svg viewBox="0 0 24 24" {...P}><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></svg>,
  bolt: <svg viewBox="0 0 24 24" {...P}><path d="M13 2L4 14h7l-1 8 9-12h-7z" /></svg>,
  chart: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>,
  sliders: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></svg>,
};

export function Pill({ st, children }: { st: string; children?: ReactNode }) {
  return <span className={'pill st-' + st}>{children ?? LABEL[st] ?? st}</span>;
}

export function Field({ id, label, error, hint, children }: { id?: string; label: ReactNode; error?: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      {id ? <label htmlFor={id}>{label}</label> : <span className="label">{label}</span>}
      {children}
      {hint ? <span className="hint">{hint}</span> : null}
      {error ? <p className="err">{error}</p> : null}
    </div>
  );
}

export function PasswordInput(props: { id: string; value: string; onChange: (v: string) => void; autoComplete: string; invalid?: boolean; describedBy?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="pw-wrap">
      <input id={props.id} type={show ? 'text' : 'password'} autoComplete={props.autoComplete} value={props.value} onChange={(e) => props.onChange(e.target.value)}
        aria-invalid={props.invalid || undefined} aria-describedby={props.describedBy} />
      <button type="button" onClick={() => setShow(!show)}>{show ? 'Hide' : 'Show'}</button>
    </div>
  );
}

export function PwRules({ value, id }: { value: string; id?: string }) {
  return <ul className="pwrules" id={id}>{passwordChecks(value).map((c) => <li key={c.id} className={c.ok ? 'ok' : ''}>{c.label}</li>)}</ul>;
}

export function Seg<T extends string>({ value, options, onChange, label }: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)}>{l}</button>)}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', k);
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { document.removeEventListener('keydown', k); prev?.focus?.(); };
  }, [onClose]);
  return (
    <div className="scrim" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" ref={ref} tabIndex={-1}>
        <div className="grab" />
        <div className="sheet-h"><h2 id="sheetTitle">{title}</h2><button className="iconbtn" onClick={onClose} aria-label="Close">{Icons.close}</button></div>
        {children}
      </div>
    </div>
  );
}

/** A button that asks once ("Confirm …") before running a destructive action. */
export function ConfirmButton({ label, confirm, onConfirm, className = 'btn sm ghost danger', busyLabel }: { label: string; confirm: string; onConfirm: () => Promise<unknown> | void; className?: string; busyLabel?: string }) {
  const [step, setStep] = useState<0 | 1 | 2>(0);
  useEffect(() => { if (step !== 1) return; const t = setTimeout(() => setStep(0), 6000); return () => clearTimeout(t); }, [step]);
  if (step === 0) return <button type="button" className={className} onClick={() => setStep(1)}>{label}</button>;
  return (
    <button type="button" className="btn sm stop" disabled={step === 2} onClick={async () => { setStep(2); try { await onConfirm(); } finally { setStep(0); } }}>
      {step === 2 ? busyLabel || 'Working…' : confirm}
    </button>
  );
}

export function Empty({ children }: { children: ReactNode }) { return <div className="empty">{children}</div>; }
