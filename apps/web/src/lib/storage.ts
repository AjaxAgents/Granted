/*
 * Small key-value storage for the session token and preferences.
 * iPhone app: the iOS Keychain (via @aparajita/capacitor-secure-storage).
 * Web: localStorage (wrapped, because private windows can block it).
 */
import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();

async function secure() {
  const m = await import('@aparajita/capacitor-secure-storage');
  return m.SecureStorage;
}

export async function getSecret(key: string): Promise<string | null> {
  if (isNative()) { try { const v = await (await secure()).get(key); return typeof v === 'string' ? v : null; } catch { return null; } }
  try { return localStorage.getItem(key); } catch { return null; }
}
export async function setSecret(key: string, value: string | null): Promise<void> {
  if (isNative()) {
    const s = await secure();
    try { if (value === null) await s.remove(key); else await s.set(key, value); } catch { /* keychain unavailable */ }
    return;
  }
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* storage blocked */ }
}

export function getPref<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
}
export function setPref(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage blocked */ }
}
