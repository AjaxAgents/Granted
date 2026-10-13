/*
 * Storage port. The services only ever talk to this interface, so the same
 * code runs on Azure SQL (apps/api/src/sql-store.ts) and in memory (tests and
 * the offline demo).
 */
import type { CollectionName, Collections } from './types';

export type Filter<T> = Partial<{ [K in keyof T]: T[K] }>;

export interface Store {
  get<C extends CollectionName>(c: C, id: string): Promise<Collections[C] | null>;
  /** Records whose fields equal every value in the filter. */
  find<C extends CollectionName>(c: C, filter?: Filter<Collections[C]>): Promise<Collections[C][]>;
  put<C extends CollectionName>(c: C, rec: Collections[C]): Promise<void>;
  remove<C extends CollectionName>(c: C, id: string): Promise<void>;
  /**
   * Runs fn while holding an exclusive lock on `key` (e.g. a project ID), so
   * capacity checks and pass issue cannot race. SQL: a transaction plus
   * sp_getapplock. Memory: a promise queue.
   */
  withLock<T>(key: string, fn: () => Promise<T>): Promise<T>;
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function matches(rec: Record<string, unknown>, filter?: Record<string, unknown>): boolean {
  if (!filter) return true;
  for (const k of Object.keys(filter)) if (filter[k] !== undefined && rec[k] !== filter[k]) return false;
  return true;
}

export type Snapshot = { [C in CollectionName]?: Record<string, Collections[C]> };

/** In-memory store. Copies on read and write so callers can never mutate stored state by accident. */
export class MemoryStore implements Store {
  private data: { [C in CollectionName]?: Map<string, Collections[C]> } = {};
  private locks = new Map<string, Promise<unknown>>();
  /** Called after every write (the browser demo uses it to save to localStorage). */
  onChange?: () => void;

  constructor(snapshot?: Snapshot) { if (snapshot) this.load(snapshot); }

  private col<C extends CollectionName>(c: C): Map<string, Collections[C]> {
    let m = this.data[c] as Map<string, Collections[C]> | undefined;
    if (!m) { m = new Map(); (this.data as Record<string, unknown>)[c] = m; }
    return m;
  }
  async get<C extends CollectionName>(c: C, id: string) { const v = this.col(c).get(id); return v ? clone(v) : null; }
  async find<C extends CollectionName>(c: C, filter?: Filter<Collections[C]>) {
    const out: Collections[C][] = [];
    for (const v of this.col(c).values()) if (matches(v as unknown as Record<string, unknown>, filter as Record<string, unknown>)) out.push(clone(v));
    return out;
  }
  async put<C extends CollectionName>(c: C, rec: Collections[C]) { this.col(c).set((rec as { id: string }).id, clone(rec)); this.onChange?.(); }
  async remove<C extends CollectionName>(c: C, id: string) { this.col(c).delete(id); this.onChange?.(); }
  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(key) || Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => { release = r; });
    const chain = prev.then(() => mine);
    this.locks.set(key, chain);
    await prev.catch(() => undefined);
    try { return await fn(); } finally { release(); if (this.locks.get(key) === chain) this.locks.delete(key); }
  }

  snapshot(): Snapshot {
    const out: Record<string, Record<string, unknown>> = {};
    for (const [c, m] of Object.entries(this.data)) out[c] = Object.fromEntries((m as Map<string, unknown>).entries());
    return clone(out) as Snapshot;
  }
  load(s: Snapshot) {
    this.data = {};
    for (const [c, recs] of Object.entries(s)) this.data[c as CollectionName] = new Map(Object.entries(clone(recs) || {})) as never;
  }
  clear() { this.data = {}; this.onChange?.(); }
}
