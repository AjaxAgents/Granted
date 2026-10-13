import { formatPhone, normEmail, validateSignUp, type SignUpForm } from '@granted/core';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import logoBlue from '../assets/logo-blue-400.png';
import { ApiError } from '../lib/api';
import { useApp } from '../state';
import { Field, Icons, PasswordInput, PwRules } from '../ui/components';

function Links() {
  const { api } = useApp();
  return (
    <>
      <div className="links"><a href="./privacy.html" target="_blank" rel="noopener">Privacy</a><a href="./terms.html" target="_blank" rel="noopener">Terms</a><a href="./support.html" target="_blank" rel="noopener">Support</a></div>
      {api.mode === 'demo' ? <p className="fine">Demo: data stays on this device and no email is sent. Don’t use a real password here.</p> : null}
    </>
  );
}

export function Login() {
  const app = useApp();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!email || !pw) { setErr('Enter your email and password.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await app.api.signIn(normEmail(email), pw);
      if ('needsVerification' in r) { app.setVerifyEmail(r.email); app.setDevCode(r.devCode || ''); app.go('verify'); return; }
      await app.signedIn();
    } catch (x) {
      setErr(x instanceof Error ? x.message : 'Sign-in failed.'); setPw('');
      setTimeout(() => (document.getElementById('li_pw') as HTMLInputElement | null)?.focus(), 0);
    } finally { setBusy(false); }
  }

  return (
    <main className="auth">
      <div className="auth-card">
        <img className="auth-logo" src={logoBlue} alt="Ajax" />
        <h1>Sign in to Granted</h1>
        <p className="lede">Delivery booking and gate access</p>
        <form onSubmit={submit} noValidate>
          <Field id="li_email" label="Email"><input id="li_email" type="email" autoComplete="username" inputMode="email" autoCapitalize="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
          <Field id="li_pw" label="Password"><PasswordInput id="li_pw" value={pw} onChange={setPw} autoComplete="current-password" /></Field>
          {err ? <p className="err" role="alert">{err}</p> : null}
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <button className="link-grey" onClick={() => app.go('forgot')}>Forgot password?</button>
        <div className="divider" />
        <button className="link-grey" onClick={() => app.go('signup')}>New to Granted? <b>Create an account</b></button>
      </div>
      {app.api.demo ? (
        <details className="demo-accts"><summary>Demo accounts</summary>
          <div className="list">
            {app.api.demo.accounts.map((d) => (
              <button type="button" key={d.email} onClick={() => { setEmail(d.email); setPw(app.api.demo!.password); setTimeout(() => (document.querySelector('.auth form button[type=submit]') as HTMLElement | null)?.focus(), 0); }}>
                <b>{d.label}</b><span>{d.email}</span>
              </button>
            ))}
            <span className="hint">Password for all demo accounts: <span className="mono">{app.api.demo.password}</span></span>
          </div>
        </details>
      ) : null}
      <Links />
    </main>
  );
}

export function Signup() {
  const app = useApp();
  const [f, setF] = useState<SignUpForm & { code?: string }>({ declaredAjax: '' });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const v = validateSignUp(f);
  const set = (k: keyof (SignUpForm & { code?: string }), val: unknown) => setF((x) => Object.assign({}, x, { [k]: val }));
  const inv = (k: string) => (errs[k] ? true : undefined);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const local = Object.assign({}, v.errors) as Record<string, string>;
    if (Object.keys(local).length) { setErrs(local); focusFirst(); return; }
    setBusy(true);
    try {
      const r = await app.api.signUp(Object.assign({}, f, { phone: formatPhone(f.phone) }));
      app.setVerifyEmail(r.email); app.setDevCode(r.devCode || ''); app.go('verify');
    } catch (x) {
      if (x instanceof ApiError && x.fields) { setErrs(x.fields); focusFirst(); } else setErrs({ form: x instanceof Error ? x.message : 'Sign-up failed.' });
    } finally { setBusy(false); }
  }
  const focusFirst = () => setTimeout(() => (document.querySelector('[aria-invalid="true"]') as HTMLElement | null)?.focus(), 0);

  return (
    <main className="auth" style={{ justifyContent: 'flex-start' }}>
      <div className="auth-top" style={{ position: 'relative', justifyContent: 'center' }}>
        <button className="iconbtn back" onClick={() => app.go('login')} aria-label="Back to sign in" style={{ position: 'absolute', left: 0 }}>{Icons.back}</button>
        <img src={logoBlue} alt="Ajax" style={{ width: 72 }} />
      </div>
      <div className="auth-card auth-wide">
        <h1>Create your account</h1>
        <p className="lede">Use your work email. You’ll confirm it with a code.</p>
        <form onSubmit={submit} noValidate>
          <div className="grid2">
            <Field id="su_first" label="First name" error={errs.first}><input id="su_first" autoComplete="given-name" value={f.first || ''} onChange={(e) => set('first', e.target.value)} aria-invalid={inv('first')} /></Field>
            <Field id="su_last" label="Last name" error={errs.last}><input id="su_last" autoComplete="family-name" value={f.last || ''} onChange={(e) => set('last', e.target.value)} aria-invalid={inv('last')} /></Field>
          </div>
          <Field id="su_phone" label="Phone number" error={errs.phone}><input id="su_phone" type="tel" inputMode="tel" autoComplete="tel" value={f.phone || ''} onChange={(e) => set('phone', e.target.value)} aria-invalid={inv('phone')} /></Field>
          <Field id="su_email" label="Email" error={errs.email}><input id="su_email" type="email" inputMode="email" autoComplete="email" autoCapitalize="off" spellCheck={false} value={f.email || ''} onChange={(e) => set('email', e.target.value)} aria-invalid={inv('email')} /></Field>
          <Field id="su_pw" label="Password" error={errs.password}>
            <PasswordInput id="su_pw" value={f.password || ''} onChange={(x) => set('password', x)} autoComplete="new-password" invalid={!!errs.password} describedBy="pwrules" />
            <PwRules value={f.password || ''} id="pwrules" />
          </Field>
          <Field id="su_company" label="Company name" error={errs.company}><input id="su_company" autoComplete="organization" value={f.company || ''} onChange={(e) => set('company', e.target.value)} aria-invalid={inv('company')} /></Field>
          <div className="field">
            <span className="label" id="ajaxLbl">Member of Ajax Building Company?</span>
            <div className="seg" role="group" aria-labelledby="ajaxLbl" style={{ alignSelf: 'flex-start' }}>
              <button type="button" aria-pressed={f.declaredAjax === 'yes'} onClick={() => setF((x) => Object.assign({}, x, { declaredAjax: 'yes', ajaxNoteConfirmed: false }))}>Yes</button>
              <button type="button" aria-pressed={f.declaredAjax === 'no'} onClick={() => setF((x) => Object.assign({}, x, { declaredAjax: 'no', ajaxNoteConfirmed: false }))}>No</button>
            </div>
            {v.ajaxNote ? (
              <div className="note warn">{v.ajaxNote}
                <label><input type="checkbox" checked={!!f.ajaxNoteConfirmed} onChange={(e) => set('ajaxNoteConfirmed', e.target.checked)} /> I understand, continue</label>
              </div>
            ) : null}
            {errs.declaredAjax ? <p className="err">{errs.declaredAjax}</p> : null}
          </div>
          <Field id="su_code" label={<>Project code <span className="muted" style={{ fontWeight: 400 }}>(optional)</span></>} error={errs.code}
            hint="From your project admin. You can add it later, but you need one to book or receive deliveries.">
            <input id="su_code" className="mono" autoCapitalize="characters" autoComplete="off" spellCheck={false} placeholder="e.g. DDC2-7HKQ" value={f.code || ''} onChange={(e) => set('code', e.target.value)} aria-invalid={inv('code')} />
          </Field>
          <p className="hint">By creating an account you agree to the <a href="./terms.html" target="_blank" rel="noopener">Terms</a> and the <a href="./privacy.html" target="_blank" rel="noopener">Privacy Policy</a>.</p>
          {errs.form ? <p className="err" role="alert">{errs.form}</p> : null}
          <button className="btn primary block" type="submit" disabled={busy}>{busy ? 'Creating account…' : 'Create account'}</button>
        </form>
        <button className="link-grey" onClick={() => app.go('login')}>Already have an account? <b>Sign in</b></button>
      </div>
      <Links />
    </main>
  );
}

export function Verify() {
  const app = useApp();
  const [code, setCode] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { if (!app.verifyEmail) app.go('login'); else ref.current?.focus(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!app.verifyEmail) return null;

  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setErr('');
    try { const r = await app.api.verify(app.verifyEmail, code.trim()); app.setDevCode(''); await app.signedIn(r.message); }
    catch (x) { setErr(x instanceof Error ? x.message : 'That code didn’t work.'); }
    finally { setBusy(false); }
  }
  return (
    <main className="auth"><div className="auth-card">
      <img className="auth-logo" src={logoBlue} alt="Ajax" style={{ width: 96 }} />
      <h1>Check your email</h1>
      <p className="lede">We sent a 6-digit code to <b>{app.verifyEmail}</b>.</p>
      {app.devCode ? <div className="demo-code">Demo: no real email is sent. Your code is <b>{app.devCode}</b></div> : null}
      <form onSubmit={submit} noValidate>
        <Field id="vf_code" label="Code"><input id="vf_code" ref={ref} inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="mono" style={{ letterSpacing: '.3em', fontSize: 22, textAlign: 'center' }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
        {err ? <p className="err" role="alert">{err}</p> : null}
        <button className="btn primary block" type="submit" disabled={busy || code.length !== 6}>Confirm email</button>
      </form>
      <button className="link-grey" onClick={() => app.run(() => app.api.resend(app.verifyEmail, 'signup'), (r) => { app.setDevCode(r.devCode || ''); return 'New code sent.'; })}>Didn’t get it? <b>Send a new code</b></button>
      <button className="link-grey" onClick={() => app.go('login')}>Back to sign in</button>
    </div></main>
  );
}

export function Forgot() {
  const app = useApp();
  const [step, setStep] = useState<1 | 2>(1);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [dev, setDev] = useState('');

  async function one(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { const r = await app.api.forgot(normEmail(email)); setDev(r.devCode || ''); setStep(2); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); }
  }
  async function two(e: FormEvent) {
    e.preventDefault(); setErr('');
    try { await app.api.reset(normEmail(email), code.trim(), pw); app.go('login'); app.toast('Password updated. Sign in with your new password.'); }
    catch (x) { setErr(x instanceof Error ? x.message : 'Try again.'); }
  }
  return (
    <main className="auth"><div className="auth-card">
      <div className="auth-top" style={{ maxWidth: 'none' }}><button className="iconbtn back" onClick={() => app.go('login')} aria-label="Back to sign in">{Icons.back}</button></div>
      <h1>Reset your password</h1>
      {step === 1 ? (
        <>
          <p className="lede">Enter your email and we’ll send a code.</p>
          <form onSubmit={one} noValidate>
            <Field id="fg_email" label="Email"><input id="fg_email" type="email" inputMode="email" autoCapitalize="off" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            {err ? <p className="err" role="alert">{err}</p> : null}
            <button className="btn primary block" type="submit">Send code</button>
          </form>
        </>
      ) : (
        <>
          <p className="lede">If an account exists for <b>{email}</b>, we sent it a code.</p>
          {dev ? <div className="demo-code">Demo: your code is <b>{dev}</b></div> : null}
          <form onSubmit={two} noValidate>
            <Field id="fg_code" label="Code"><input id="fg_code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="mono" style={{ letterSpacing: '.3em' }} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></Field>
            <Field id="fg_pw" label="New password"><PasswordInput id="fg_pw" value={pw} onChange={setPw} autoComplete="new-password" /><PwRules value={pw} /></Field>
            {err ? <p className="err" role="alert">{err}</p> : null}
            <button className="btn primary block" type="submit">Set new password</button>
          </form>
        </>
      )}
    </div></main>
  );
}
