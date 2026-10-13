import { ROLES, deliveryStatus, fmtClock, fmtDate, toWallClock, ymd, type DeliveryState, type Role } from '@granted/core';
import type { DeliveryRequest, PassRecord, ProjectView } from '@granted/services';

export function plural(n: number, w: string, pl?: string): string {
  return n + ' ' + (Number(n) === 1 ? w : (pl || (/(s|x|ch|sh)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's')));
}
export const roleLabel = (r: Role | string | null | undefined) => (r && r in ROLES ? ROLES[r as Role].label : String(r || ''));
export const LABEL: Record<string, string> = { approved: 'Approved', review: 'Needs review', rejected: 'Rejected', cancelled: 'Cancelled', arrived: 'Arrived', noshow: 'No-show' };
export const byWhen = (a: { date: string; slot: string }, b: { date: string; slot: string }) => (a.date + a.slot).localeCompare(b.date + b.slot);
export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

/** Site helpers bound to one project view and the current time. */
export function site(view: ProjectView, nowInstant: Date) {
  const tz = view.project.timeZone;
  const wall = toWallClock(nowInstant, tz);
  const passOf = (r: DeliveryRequest): PassRecord | null => (r.passCode ? view.passes.find((p) => p.code === r.passCode) || null : null);
  return {
    tz, wall, today: ymd(wall),
    clock: (iso: string) => fmtClock(toWallClock(new Date(iso), tz)),
    label: (iso: string) => { const w = toWallClock(new Date(iso), tz); return fmtDate(ymd(w)) + ' ' + fmtClock(w); },
    dayOf: (iso: string) => ymd(toWallClock(new Date(iso), tz)),
    passOf,
    statusOf: (r: DeliveryRequest): DeliveryState => deliveryStatus(r, passOf(r), wall, view.project.settings),
    gate: (id: string) => view.project.gates.find((g) => g.id === id) || { id, name: id, capacityPerSlot: 0 },
    zone: (id: string) => view.project.zones.find((z) => z.id === id) || { id, name: id, capacityPallets: 0 },
  };
}
export type Site = ReturnType<typeof site>;
