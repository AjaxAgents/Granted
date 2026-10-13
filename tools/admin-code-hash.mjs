#!/usr/bin/env node
/*
 * Makes the hash of the admin set-up code for the API's ADMIN_SETUP_CODE_HASH
 * setting (stored in Key Vault as admin-setup-code-hash). The code is read from
 * the keyboard, not the command line, so it never lands in shell history.
 *
 *   node tools/admin-code-hash.mjs
 *
 * The output looks like pbkdf2$600000$<salt>$<hash>. Only the hash is stored anywhere;
 * the code itself is never written to the repository, the app, or the database.
 */
import { webcrypto as crypto } from 'node:crypto';

const PEPPER = 'granted-admin-v1:';
const ITER = 600000;

/** Reads one line without echoing it (keyboard), or the next line of piped input. */
const piped = [];
let pipedRead = false;
async function ask(q) {
  if (!process.stdin.isTTY) {
    if (!pipedRead) { pipedRead = true; let t = ''; for await (const c of process.stdin) t += c; piped.push(...t.split(/\r?\n/)); }
    return piped.shift() || '';
  }
  process.stderr.write(q);
  return new Promise((res) => {
    let v = '';
    process.stdin.setRawMode(true); process.stdin.resume(); process.stdin.setEncoding('utf8');
    const on = (ch) => {
      if (ch === '\r' || ch === '\n') { process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', on); process.stderr.write('\n'); res(v); }
      else if (ch === '\u0003') process.exit(1);
      else if (ch === '\u007f') v = v.slice(0, -1);
      else v += ch;
    };
    process.stdin.on('data', on);
  });
}
const norm = (c) => String(c || '').toUpperCase().replace(/[^A-Z0-9-]/g, '');
const a = norm(await ask('Admin set-up code: '));
const b = norm(await ask('Type it again: '));
if (!a || a !== b) { console.error('The codes did not match.'); process.exit(1); }
if (a.length < 12) console.error('Warning: codes shorter than 12 characters can be guessed. Prefer a long random code.');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(PEPPER + a), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: ITER }, key, 256);
const b64 = (u8) => Buffer.from(u8).toString('base64');
console.log(`pbkdf2$${ITER}$${b64(salt)}$${b64(new Uint8Array(bits))}`);
