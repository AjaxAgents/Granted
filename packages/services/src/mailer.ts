import type { Mail } from './types';

/** Sends one email. The services also keep a copy of delivery and team emails for the in-app Messages and Activity views. */
export interface Mailer { send(mail: Mail): Promise<void> }

/** Sends nothing. Used by the offline demo, where the in-app inbox shows every email instead. */
export const nullMailer: Mailer = { async send() { /* nothing */ } };

/** Collects mail in memory (tests). */
export class MemoryMailer implements Mailer {
  sent: Mail[] = [];
  async send(mail: Mail) { this.sent.push(mail); }
}
