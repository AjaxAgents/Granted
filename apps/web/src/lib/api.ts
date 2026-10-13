/*
 * What the screens call. Two implementations:
 *   HttpApi  talks to the Granted API (production, and local development)
 *   DemoApi  runs the same services in the browser on demo data (no server; for trying the app)
 * Both run the same rule and permission code, so the demo behaves exactly like the real thing.
 */
import type { Activity, Gate, Role, SignUpForm, Zone } from '@granted/core';
import type { DeliveryInput, DeliveryRequest, GateCheckView, HomeView, Invite, Project, ProjectView, PublicUser } from '@granted/services';

export type SignInResult = { ok: true } | { needsVerification: true; email: string; devCode?: string };

export interface DemoControls {
  clockMode(): 'auto' | 'set' | 'live';
  setClock(date: string, time: string): void;
  autoClock(): void;
  liveClock(): void;
  reset(): Promise<void>;
  /** Every email the demo would have sent to this address. */
  inbox(email: string): Promise<{ ts: string; subject: string; body: string; kind: string }[]>;
  accounts: { label: string; email: string }[];
  password: string;
}

export interface Api {
  readonly mode: 'demo' | 'server';
  readonly demo?: DemoControls;
  /** Current time (the demo can move it). */
  now(): Date;
  isSignedIn(): boolean;
  restore(): Promise<boolean>;
  viewAs: Role | null;

  signUp(f: SignUpForm & { code?: string }): Promise<{ email: string; devCode?: string }>;
  verify(email: string, code: string): Promise<{ message: string }>;
  resend(email: string, purpose: 'signup' | 'reset'): Promise<{ devCode?: string }>;
  signIn(email: string, password: string): Promise<SignInResult>;
  forgot(email: string): Promise<{ devCode?: string }>;
  reset(email: string, code: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  home(): Promise<HomeView>;
  updateProfile(f: { first: string; last: string; phone: string; company: string }): Promise<PublicUser>;
  changePassword(current: string, next: string): Promise<void>;
  deleteAccount(password: string): Promise<void>;

  project(id: string): Promise<ProjectView>;
  createProject(name: string, location: string, timeZone?: string): Promise<Project>;
  enterCode(code: string): Promise<{ ok: boolean; message: string; projectId?: string }>;
  leaveProject(id: string): Promise<void>;
  saveSettings(id: string, patch: { name?: string; location?: string; timeZone?: string; settings?: Record<string, unknown>; gates?: Gate[]; zones?: Zone[] }): Promise<void>;
  replaceLookahead(id: string, activities: Activity[]): Promise<number>;
  regenerateCode(id: string): Promise<string>;
  deleteProject(id: string, confirmCode: string): Promise<void>;
  setSuspended(id: string, subId: string, suspended: boolean): Promise<void>;

  decideJoin(joinId: string, approve: boolean, role?: Role, trade?: string): Promise<void>;
  invite(projectId: string, email: string, role: Role, trade: string): Promise<Invite>;
  revokeInvite(id: string): Promise<void>;
  changeRole(memberId: string, role: Role, trade?: string): Promise<void>;
  removeMember(memberId: string): Promise<void>;

  submitRequest(projectId: string, input: DeliveryInput): Promise<{ request: DeliveryRequest; nextOpen: { date: string; slot: string; label: string } | null }>;
  cancelRequest(id: string): Promise<void>;
  decideRequest(id: string, approve: boolean, note: string): Promise<DeliveryRequest>;
  emergencyPass(projectId: string, input: { subId: string; material: string; gateId: string; slot: string; zoneId: string; pallets: number }): Promise<DeliveryRequest>;
  noShowSweep(projectId: string): Promise<number>;

  checkGate(projectId: string, code: string): Promise<GateCheckView>;
  admit(projectId: string, code: string): Promise<{ check: GateCheckView; message: string }>;
  turnAway(projectId: string, code: string): Promise<{ check: GateCheckView; message: string }>;
}

/** An error with a message safe to show, and optional per-field messages. */
export class ApiError extends Error {
  constructor(message: string, public status = 400, public code = 'error', public fields?: Record<string, string>) { super(message); }
}
