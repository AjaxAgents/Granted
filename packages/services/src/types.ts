/*
 * Stored records. Collection names and fields match the prototype one to one,
 * and db/migrations/001_schema.sql maps each collection to a table.
 * Every timestamp is an ISO-8601 instant (UTC). Dates (YYYY-MM-DD) and slots
 * (HH:MM) are site wall-clock values in the project's time zone.
 */
import type { Activity, Gate, Pass, RequestStatus, Role, Settings, Zone } from '@granted/core';

export interface User {
  id: string;
  email: string;
  first: string;
  last: string;
  phone: string;
  company: string;
  /** Set by the server from the confirmed email domain. */
  isAjax: boolean;
  /** Ajax admin account: may create projects. Set only by the admin set-up code or an existing Ajax admin. */
  isAdminAccount: boolean;
  verified: boolean;
  createdAt: string;
  lastLoginAt?: string;
  /** Project code typed at sign-up, handled when the email is confirmed. */
  pendingCode?: string;
  /** External identity (Entra External ID object ID) when that sign-in is used. */
  externalId?: string;
  deleted?: boolean;
  deletedAt?: string;
}

/** Local sign-in only. Never returned by any API. */
export interface Credential {
  id: string; // = userId
  hash: string;
  salt: string;
  iter: number;
  failures: string[];
  /** Bumped on password change or "sign out everywhere"; sessions carry it. */
  sessionVersion: number;
  verify?: { codeHash: string; exp: string; purpose: 'signup' | 'reset'; tries: number } | null;
}

export interface Project {
  id: string;
  name: string;
  location: string;
  code: string;
  createdBy: string;
  createdAt: string;
  deleted: boolean;
  deletedAt?: string;
  deletedBy?: string;
  /** companyKey -> true when that company's booking rights are suspended. */
  suspended: Record<string, boolean>;
  gates: Gate[];
  zones: Zone[];
  activities: Activity[];
  settings: Settings;
  /** Demo projects only: the sample day the demo clock starts on. */
  demoAnchor?: string;
}

export type MemberVia = 'creator' | 'request' | 'invite' | 'demo';
export interface Member {
  id: string; // projectId + '__' + userId
  projectId: string;
  userId: string;
  role: Role;
  trade: string;
  status: 'active' | 'removed';
  addedAt: string;
  addedBy: string;
  via: MemberVia;
  removedAt?: string;
  removedBy?: string;
}

export interface JoinRequest {
  id: string;
  projectId: string;
  userId: string;
  at: string;
  status: 'pending' | 'approved' | 'declined';
  role?: Role | null;
  decidedBy?: string;
  decidedAt?: string;
}

export interface Invite {
  id: string;
  projectId: string;
  email: string;
  role: Role;
  trade: string;
  by: string;
  at: string;
  expiresAt: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  acceptedAt?: string;
  userId?: string;
}

export interface ReasonRecord { code: string; title: string; remedy: string }

export interface DeliveryRequest {
  id: string;
  projectId: string;
  subId: string;
  subName: string;
  userId: string;
  submitterEmail: string;
  submittedBy: string;
  activityId: string;
  gateId: string;
  date: string;
  slot: string;
  zoneId: string;
  material: string;
  quantity: number;
  unit: string;
  pallets: number;
  weightLbs: number | null;
  carrier: string;
  truck: string;
  pocName: string;
  pocPhone: string;
  justification: string;
  status: RequestStatus;
  stagedUntil: string | null;
  reasons: ReasonRecord[];
  submittedAt: string;
  decidedAt?: string;
  decidedBy?: string;
  reviewNote?: string;
  passCode: string | null;
  override?: boolean;
  cancelledAt?: string;
  noshowNotified?: string;
  maintenance?: boolean;
  demo?: boolean;
}

export interface PassRecord extends Pass {
  id: string; // = code
  projectId: string;
  issuedAt: string;
  usedBy?: string;
  voidedAt?: string;
  voidReason?: string;
  demo?: boolean;
}

export interface GateEvent {
  id: string;
  projectId: string;
  ts: string;
  code: string;
  color: 'green' | 'red';
  reason: string;
  title: string;
  action: 'admitted' | 'turned away';
  guard: string;
  guardUserId?: string;
  requestId: string | null;
  subId: string | null;
  maintenance?: boolean;
  demo?: boolean;
}

export type MailKind = 'account' | 'team' | 'delivery';
export interface Mail {
  id: string;
  ts: string;
  to: string;
  subject: string;
  body: string;
  kind: MailKind;
  event?: string;
  role?: string;
  projectId?: string | null;
  requestId?: string | null;
  /** Gate pass code to attach as a QR image (contractor's approval and emergency emails). */
  attachQr?: string | null;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string | null;
  action: string;
  projectId?: string | null;
  target?: string | null;
  details?: Record<string, unknown>;
  maintenance?: boolean;
}

export interface Throttle { id: string; hits: string[] }

export interface Collections {
  users: User;
  credentials: Credential;
  projects: Project;
  members: Member;
  joinreqs: JoinRequest;
  invites: Invite;
  requests: DeliveryRequest;
  passes: PassRecord;
  gatelog: GateEvent;
  mail: Mail;
  audit: AuditEntry;
  throttle: Throttle;
}
export type CollectionName = keyof Collections;
export const COLLECTIONS: CollectionName[] = ['users', 'credentials', 'projects', 'members', 'joinreqs', 'invites', 'requests', 'passes', 'gatelog', 'mail', 'audit', 'throttle'];

/** Who is calling. viewAs is the maintenance-mode view, honoured only for Ajax admin accounts that are project Admins. */
export interface Actor { userId: string; viewAs?: Role | null; ip?: string }
