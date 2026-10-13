/*
 * Request body shapes. Anything that doesn't match is refused before it
 * reaches the services (which then apply the business rules).
 */
import { z } from 'zod';

const s = (max: number) => z.string().max(max);
const role = z.enum(['contractor', 'access', 'admin']);
const num = z.union([z.number(), z.string().max(20)]);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);

export const Schemas = {
  signUp: z.strictObject({
    first: s(100), last: s(100), phone: s(30), email: s(254), password: s(128), company: s(150),
    declaredAjax: z.enum(['yes', 'no', '']), ajaxNoteConfirmed: z.boolean().optional(), code: s(60).optional(),
  }),
  verify: z.strictObject({ email: s(254), code: s(10) }),
  resend: z.strictObject({ email: s(254), purpose: z.enum(['signup', 'reset']) }),
  signIn: z.strictObject({ email: s(254), password: s(128) }),
  forgot: z.strictObject({ email: s(254) }),
  reset: z.strictObject({ email: s(254), code: s(10), password: s(128) }),
  profile: z.strictObject({ first: s(100), last: s(100), phone: s(30), company: s(150) }),
  externalProfile: z.strictObject({ first: s(100), last: s(100), phone: s(30), company: s(150), code: s(60).optional() }),
  password: z.strictObject({ current: s(128), next: s(128) }),
  deleteAccount: z.strictObject({ password: s(128).optional() }),
  createProject: z.strictObject({ name: s(120), location: s(160).optional(), timeZone: s(60).optional(), sampleLookahead: z.boolean().optional() }),
  code: z.strictObject({ code: s(60) }),
  settings: z.strictObject({
    name: s(120).optional(), location: s(160).optional(), timeZone: s(60).optional(),
    settings: z.strictObject({
      minNoticeHours: z.number().optional(), maxDaysBeforeInstall: z.number().optional(), gateToleranceMinutes: z.number().optional(),
      maxPalletsPerRequest: z.number().optional(), gateOpen: hhmm.optional(), gateClose: hhmm.optional(), workDays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
      blackoutDates: z.array(ymd).max(200).optional(), slotMinutes: z.number().optional(), noShowGraceMinutes: z.number().optional(), duplicateWindowDays: z.number().optional(),
    }).optional(),
    gates: z.array(z.strictObject({ id: s(20), name: s(60), capacityPerSlot: z.number(), active: z.boolean().optional() })).max(12).optional(),
    zones: z.array(z.strictObject({ id: s(20), name: s(60), capacityPallets: z.number(), active: z.boolean().optional() })).max(40).optional(),
  }),
  lookahead: z.strictObject({ activities: z.array(z.strictObject({ id: s(30), name: s(120), trade: s(40), start: ymd, finish: ymd })).max(2000) }),
  deleteProject: z.strictObject({ confirmCode: s(60) }),
  suspend: z.strictObject({ subId: s(120), suspended: z.boolean() }),
  joinDecision: z.strictObject({ approve: z.boolean(), role: role.optional(), trade: s(40).optional() }),
  invite: z.strictObject({ email: s(254), role, trade: s(40).optional() }),
  member: z.strictObject({ role, trade: s(40).optional() }),
  delivery: z.strictObject({
    id: s(40).nullable().optional(), activityId: s(30), gateId: s(20), date: s(10), slot: s(5), zoneId: s(20),
    material: s(200), quantity: num, unit: s(20), pallets: num, weightLbs: num.nullable().optional(),
    carrier: s(120).optional(), truck: s(60).optional(), pocName: s(120), pocPhone: s(30), justification: s(1000).optional(),
  }),
  decision: z.strictObject({ approve: z.boolean(), note: s(500).optional() }),
  emergency: z.strictObject({ subId: s(120), material: s(200), gateId: s(20), slot: hhmm, zoneId: s(20), pallets: z.number() }),
  gate: z.strictObject({ code: s(64) }),
};
