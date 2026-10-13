/*
 * Email through Azure Communication Services. The Function App's managed
 * identity is used when ACS_ENDPOINT is set; a connection string (Key Vault
 * reference) is the fallback. Plain text only: no tracking pixels, no links
 * other than the app link.
 */
import { EmailClient } from '@azure/communication-email';
import { DefaultAzureCredential } from '@azure/identity';
import { qrEncode, qrToPngBase64 } from '@granted/core';
import type { Mail, Mailer } from '@granted/services';

export class AcsMailer implements Mailer {
  private client: EmailClient;
  constructor(private from: string, o: { endpoint?: string; connectionString?: string }, private log: (msg: string) => void = console.error) {
    this.client = o.connectionString ? new EmailClient(o.connectionString) : new EmailClient(o.endpoint as string, new DefaultAzureCredential());
  }
  async send(mail: Mail): Promise<void> {
    try {
      // Start the send and return; ACS retries delivery itself. Failures are logged without the body.
      await this.client.beginSend({
        senderAddress: this.from,
        content: { subject: mail.subject, plainText: mail.body + '\n\n—\nGranted · Ajax Building Company\nYou receive this because you have a Granted account or were invited to a project.' },
        recipients: { to: [{ address: mail.to }] },
        attachments: mail.attachQr ? [{ name: 'gate-pass-' + mail.attachQr + '.png', contentType: 'image/png', contentInBase64: qrToPngBase64(qrEncode(mail.attachQr), 8, 4) }] : undefined,
      });
    } catch (e) {
      this.log('Email send failed (' + mail.kind + (mail.event ? '/' + mail.event : '') + '): ' + (e instanceof Error ? e.message : String(e)));
    }
  }
}
