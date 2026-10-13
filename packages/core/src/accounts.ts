/*
 * Granted — account, project-code and permission rules.
 *
 * Pure functions. The API enforces every one of these; the app runs the same
 * file only to give instant feedback.
 */
import type { Rand } from './rules';

export const AJAX_DOMAIN = 'ajaxbuilding.com';

export type Role = 'contractor' | 'access' | 'admin';
export const ROLES: Readonly<Record<Role, { id: Role; label: string; short: string }>> = Object.freeze({
  contractor: { id: 'contractor', label: 'Contractor', short: 'Contractor' },
  access: { id: 'access', label: 'Access Control', short: 'Access Control' },
  admin: { id: 'admin', label: 'Admin', short: 'Admin' },
});
export const isRole = (r: unknown): r is Role => r === 'contractor' || r === 'access' || r === 'admin';

/** What each project role may do. The API checks this table on every call. */
export const PERMISSIONS = Object.freeze({
  'delivery.request': ['contractor', 'admin'],
  'delivery.viewOwn': ['contractor', 'admin'],
  'delivery.viewAll': ['admin'],
  'delivery.review': ['admin'],
  'delivery.emergencyPass': ['admin'],
  'gate.scan': ['access', 'admin'],
  'gate.viewToday': ['access', 'admin'],
  'gate.viewLog': ['access', 'admin'],
  'team.approve': ['admin'],
  'team.invite': ['admin'],
  'team.remove': ['admin'],
  'team.changeRole': ['admin'],
  'project.settings': ['admin'],
  'project.delete': ['admin'],
} satisfies Record<string, Role[]>);
export type Action = keyof typeof PERMISSIONS;
export function can(role: Role | null | undefined, action: Action): boolean {
  return !!role && !!PERMISSIONS[action] && (PERMISSIONS[action] as readonly string[]).includes(role);
}

export const LOCKOUT = Object.freeze({ maxAttempts: 5, minutes: 15 });

export function normEmail(e: unknown): string { return String(e || '').trim().toLowerCase(); }
export function emailDomain(e: unknown): string { const s = normEmail(e); const i = s.lastIndexOf('@'); return i < 0 ? '' : s.slice(i + 1); }
export function isValidEmail(e: unknown): boolean { const s = normEmail(e); return s.length <= 254 && /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(s); }
/** Ajax membership comes from the confirmed email domain, never from what the person ticks. */
export function isAjaxEmail(e: unknown): boolean { return isValidEmail(e) && emailDomain(e) === AJAX_DOMAIN; }

export interface PasswordCheck { id: 'len' | 'upper' | 'lower' | 'number'; label: string; ok: boolean }
export function passwordChecks(pw: unknown): PasswordCheck[] {
  const s = String(pw || '');
  return [
    { id: 'len', label: 'At least 8 characters', ok: s.length >= 8 },
    { id: 'upper', label: 'One uppercase letter', ok: /[A-Z]/.test(s) },
    { id: 'lower', label: 'One lowercase letter', ok: /[a-z]/.test(s) },
    { id: 'number', label: 'One number', ok: /[0-9]/.test(s) },
  ];
}
export function isValidPassword(pw: unknown): boolean { return passwordChecks(pw).every((c) => c.ok) && String(pw).length <= 128; }
export function phoneDigits(p: unknown): string { return String(p || '').replace(/\D/g, ''); }
export function isValidPhone(p: unknown): boolean { const d = phoneDigits(p); return d.length === 10 || (d.length === 11 && d[0] === '1'); }
export function formatPhone(p: unknown): string { let d = phoneDigits(p); if (d.length === 11) d = d.slice(1); return d.length === 10 ? d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6) : String(p || ''); }

export interface SignUpForm {
  first?: string; last?: string; phone?: string; email?: string; password?: string; company?: string;
  declaredAjax?: 'yes' | 'no' | ''; ajaxNoteConfirmed?: boolean; projectCode?: string;
}
export interface SignUpCheck { ok: boolean; errors: Partial<Record<keyof SignUpForm, string>>; isAjax: boolean; ajaxNote: string }

const MAX = { name: 60, company: 100 };
/** Validates the sign-up form. ajaxNote is shown when the Yes/No answer and the email disagree; the person confirms it to continue. */
export function validateSignUp(f: SignUpForm): SignUpCheck {
  const errors: SignUpCheck['errors'] = {};
  const first = String(f.first || '').trim(); const last = String(f.last || '').trim(); const company = String(f.company || '').trim();
  if (!first) errors.first = 'Enter your first name.'; else if (first.length > MAX.name) errors.first = 'Use ' + MAX.name + ' characters or fewer.';
  if (!last) errors.last = 'Enter your last name.'; else if (last.length > MAX.name) errors.last = 'Use ' + MAX.name + ' characters or fewer.';
  if (!isValidPhone(f.phone)) errors.phone = 'Enter a 10-digit phone number.';
  if (!isValidEmail(f.email)) errors.email = 'Enter a valid email address.';
  if (!isValidPassword(f.password)) errors.password = 'Password needs at least 8 characters with an uppercase letter, a lowercase letter and a number.';
  if (!company) errors.company = 'Enter the company you represent.'; else if (company.length > MAX.company) errors.company = 'Use ' + MAX.company + ' characters or fewer.';
  if (f.declaredAjax !== 'yes' && f.declaredAjax !== 'no') errors.declaredAjax = 'Choose Yes or No.';
  const isAjax = isAjaxEmail(f.email);
  let ajaxNote = '';
  if (f.declaredAjax === 'yes' && isValidEmail(f.email) && !isAjax) {
    ajaxNote = 'Ajax Building Company members sign up with their @' + AJAX_DOMAIN + ' email. This account will be set up as a non-Ajax account.';
  } else if (f.declaredAjax === 'no' && isAjax) {
    ajaxNote = 'This is an @' + AJAX_DOMAIN + ' address, so the account will be set up as an Ajax Building Company account.';
  }
  if (ajaxNote && !f.ajaxNoteConfirmed) errors.declaredAjax = 'Confirm the note below to continue.';
  return { ok: Object.keys(errors).length === 0, errors, isAjax, ajaxNote };
}

// ---------------------------------------------------------------- project codes

export const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
export function normalizeProjectCode(c: unknown): string { return String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 40); }
export function codePrefixFromName(name: unknown): string {
  const words = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
  let p = words.map((w) => (/^[0-9]/.test(w) ? w : w[0])).join('');
  if (p.length < 2 && words[0]) p = words[0].slice(0, 4);
  return (p || 'PRJ').slice(0, 5);
}
export function newProjectCode(name: string, existing: string[] | null | undefined, rand?: Rand): string {
  const r = rand || Math.random; const taken = new Set((existing || []).map(normalizeProjectCode));
  const prefix = codePrefixFromName(name);
  for (let i = 0; i < 1000; i++) {
    let tail = ''; for (let k = 0; k < 4; k++) tail += CODE_ALPHABET[Math.floor(r() * CODE_ALPHABET.length)];
    const code = prefix + '-' + tail; if (!taken.has(code)) return code;
  }
  throw new Error('Could not create a unique project code');
}
export function passPrefixFromCode(code: unknown): string { return normalizeProjectCode(code).split('-')[0].slice(0, 5) || 'GR'; }

export const CODE_NOT_FOUND = 'That project code was not found. Check it with your project admin.';
export type CodeKind = 'none' | 'admin' | 'join' | 'invalid';
/**
 * What happens to a project code typed at sign-up or in "Add project".
 * adminCodeMatches is computed by the caller (the API, which holds only a hash and rate-limits tries).
 * An admin-code match from a non-Ajax email gets exactly the same answer as an unknown code.
 */
export function classifyProjectCode(o: { code: unknown; email: unknown; adminCodeMatches: boolean; projectExists: boolean; alreadyAdminAccount?: boolean }): { kind: CodeKind; message: string } {
  const c = normalizeProjectCode(o.code);
  if (!c) return { kind: 'none', message: '' };
  if (o.adminCodeMatches) {
    if (isAjaxEmail(o.email)) return { kind: 'admin', message: o.alreadyAdminAccount ? 'This account already has Admin access.' : 'Admin access will be set up for this Ajax account.' };
    return { kind: 'invalid', message: CODE_NOT_FOUND };
  }
  if (o.projectExists) return { kind: 'join', message: 'A request to join will go to the project admins.' };
  return { kind: 'invalid', message: CODE_NOT_FOUND };
}

/** Sign-in throttling, given the times of recent failures. */
export function lockState(failures: (string | number | Date)[] | null | undefined, now?: Date): { locked: false; remaining: number } | { locked: true; minutesLeft: number } {
  const t = now ? now.getTime() : Date.now();
  const recent = (failures || []).filter((ts) => t - new Date(ts).getTime() < LOCKOUT.minutes * 60000);
  if (recent.length < LOCKOUT.maxAttempts) return { locked: false, remaining: LOCKOUT.maxAttempts - recent.length };
  const oldest = Math.min(...recent.map((ts) => new Date(ts).getTime()));
  return { locked: true, minutesLeft: Math.max(1, Math.ceil((oldest + LOCKOUT.minutes * 60000 - t) / 60000)) };
}

export function sixDigitCode(rand?: Rand): string { const r = rand || Math.random; let s = ''; for (let i = 0; i < 6; i++) s += Math.floor(r() * 10); return s; }

/** A company's key on a project: its name as a lower-case slug ("North Field Electrical" -> "north-field-electrical"). */
export function companyKey(name: unknown): string { return String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'company'; }
