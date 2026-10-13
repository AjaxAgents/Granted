/*
 * What the app receives. Each view contains only what the caller's role on
 * that project may see; the services build them, the API returns them as JSON.
 */
import type { Activity, Gate, Role, Settings, Sub, Zone } from '@granted/core';
import type { DeliveryRequest, GateEvent, Invite, JoinRequest, Mail, PassRecord } from './types';

export interface PublicUser {
  id: string; email: string; first: string; last: string; phone: string; company: string;
  isAjax: boolean; isAdminAccount: boolean;
}

export interface ProjectSummary { id: string; name: string; code: string; location: string; role: Role }

export interface HomeView {
  me: PublicUser;
  projects: ProjectSummary[];
  /** Projects this person asked to join that are still waiting for an admin. */
  pending: { projectId: string; name: string }[];
  /** Messages for things that happened since last time (e.g. an invite was applied). */
  notices: string[];
}

/** Minimal record of another company's booking: enough for capacity checks, nothing identifying. */
export interface Occupancy {
  id: string; gateId: string; date: string; slot: string; zoneId: string; pallets: number;
  stagedUntil: string | null; status: DeliveryRequest['status']; subId: string; activityId: string;
}

export interface MemberView {
  id: string; userId: string; role: Role; trade: string; via: string; addedAt: string;
  name: string; email: string; company: string; phone: string; isAjax: boolean;
}
export interface JoinView extends JoinRequest { name: string; email: string; company: string; phone: string; isAjax: boolean }

export interface ProjectView {
  project: {
    id: string; name: string; location: string; code: string; timeZone: string;
    settings: Settings; gates: Gate[]; zones: Zone[]; activities: Activity[];
    demoAnchor?: string;
  };
  /** Role used for this view (the maintenance view if one is active). */
  role: Role;
  realRole: Role;
  maintenance: boolean;
  canMaintain: boolean;
  /** The caller's company on this project, as the rules see it. */
  mySub: Sub;
  /** Companies (Admins see all; others see only their own). */
  subs: Sub[];
  /** Requests the caller may read in full. */
  requests: DeliveryRequest[];
  /** Everyone else's active bookings, reduced to capacity data. */
  occupancy: Occupancy[];
  passes: PassRecord[];
  gatelog: GateEvent[];
  members: MemberView[];
  joinreqs: JoinView[];
  invites: Invite[];
  /** Contractor: their own messages on this project. Admin: every email sent on this project. */
  mail: Mail[];
  /** Server time when the view was built (ISO instant). */
  serverTime: string;
}

export interface GateCheckView {
  color: 'green' | 'red';
  reason: string;
  title: string;
  remedy: string;
  code: string;
  at: string;
  request: null | {
    id: string; subName: string; material: string; quantity: number; unit: string; pallets: number;
    date: string; slot: string; gateId: string; zoneId: string; pocName: string; pocPhone: string;
    windowOpen: string; windowClose: string;
  };
}
