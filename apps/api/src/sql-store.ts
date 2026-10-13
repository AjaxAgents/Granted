/*
 * Azure SQL implementation of the services' Store.
 *
 * Each collection is a table in the [granted] schema (db/migrations): an `id`,
 * the record as JSON in `data`, and indexed computed columns for the fields
 * the services filter on. All values are sent as parameters, never pasted
 * into SQL text. withLock() runs the work in one transaction holding an
 * exclusive application lock, so capacity checks and pass issue never race.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import sql from 'mssql';
import { COLLECTIONS, type CollectionName, type Collections, type Filter, type Store } from '@granted/services';

/** Fields with an indexed computed column (c_<field>) in the schema. Other filters use JSON_VALUE. */
const INDEXED: Partial<Record<CollectionName, string[]>> = {
  users: ['email'],
  projects: ['code', 'deleted'],
  members: ['projectId', 'userId', 'status'],
  joinreqs: ['projectId', 'userId', 'status'],
  invites: ['projectId', 'email', 'status'],
  requests: ['projectId', 'userId', 'status'],
  passes: ['projectId', 'requestId'],
  gatelog: ['projectId'],
  mail: ['projectId', 'to'],
  audit: ['projectId', 'actorId'],
};
/** Written once, never changed (the app's database user has no UPDATE or DELETE on these). */
const APPEND_ONLY = new Set<CollectionName>(['gatelog', 'audit']);

const table = (c: CollectionName) => {
  if (!COLLECTIONS.includes(c)) throw new Error('Unknown collection ' + c);
  return '[granted].[' + c + ']';
};
const asText = (v: unknown) => (typeof v === 'boolean' ? (v ? 'true' : 'false') : String(v));

export interface SqlOptions { server?: string; database?: string; connectionString?: string }

export class SqlStore implements Store {
  private pool: sql.ConnectionPool;
  private ready: Promise<sql.ConnectionPool>;
  private als = new AsyncLocalStorage<{ tx: sql.Transaction }>();

  constructor(o: SqlOptions) {
    this.pool = o.connectionString
      ? new sql.ConnectionPool(o.connectionString)
      : new sql.ConnectionPool({
        server: o.server as string,
        database: o.database,
        // The Function App's managed identity signs in to Azure SQL; no password exists.
        authentication: { type: 'azure-active-directory-default', options: {} },
        options: { encrypt: true, trustServerCertificate: false },
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
      } as sql.config);
    this.ready = this.pool.connect();
  }

  private async request(): Promise<sql.Request> {
    const cur = this.als.getStore();
    if (cur) return new sql.Request(cur.tx);
    return new sql.Request(await this.ready);
  }

  async get<C extends CollectionName>(c: C, id: string): Promise<Collections[C] | null> {
    const r = await this.request();
    r.input('id', sql.NVarChar(100), id);
    const res = await r.query<{ data: string }>(`SELECT data FROM ${table(c)} WHERE id = @id`);
    return res.recordset.length ? JSON.parse(res.recordset[0].data) : null;
  }

  async find<C extends CollectionName>(c: C, filter?: Filter<Collections[C]>): Promise<Collections[C][]> {
    const r = await this.request();
    const where: string[] = [];
    let i = 0;
    for (const [k, v] of Object.entries(filter || {})) {
      if (v === undefined) continue;
      if (!/^[A-Za-z][A-Za-z0-9]*$/.test(k)) throw new Error('Bad filter field');
      const p = 'p' + i++;
      r.input(p, sql.NVarChar(400), asText(v));
      where.push(((INDEXED[c] || []) as string[]).includes(k) ? `c_${k} = @${p}` : `JSON_VALUE(data, '$.${k}') = @${p}`);
    }
    const res = await r.query<{ data: string }>(`SELECT data FROM ${table(c)}${where.length ? ' WHERE ' + where.join(' AND ') : ''}`);
    return res.recordset.map((row) => JSON.parse(row.data));
  }

  async put<C extends CollectionName>(c: C, rec: Collections[C]): Promise<void> {
    const r = await this.request();
    r.input('id', sql.NVarChar(100), (rec as { id: string }).id);
    r.input('data', sql.NVarChar(sql.MAX), JSON.stringify(rec));
    if (APPEND_ONLY.has(c)) await r.query(`INSERT INTO ${table(c)} (id, data) VALUES (@id, @data)`);
    else await r.query(`UPDATE ${table(c)} SET data = @data WHERE id = @id; IF @@ROWCOUNT = 0 INSERT INTO ${table(c)} (id, data) VALUES (@id, @data);`);
  }

  async remove<C extends CollectionName>(c: C, id: string): Promise<void> {
    if (APPEND_ONLY.has(c)) throw new Error(c + ' is append-only');
    const r = await this.request();
    r.input('id', sql.NVarChar(100), id);
    await r.query(`DELETE FROM ${table(c)} WHERE id = @id`);
  }

  async withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const lock = async (tx: sql.Transaction) => {
      const r = new sql.Request(tx);
      r.input('res', sql.NVarChar(255), key.slice(0, 255));
      const out = await r.query<{ rc: number }>(`DECLARE @rc INT; EXEC @rc = sp_getapplock @Resource = @res, @LockMode = 'Exclusive', @LockOwner = 'Transaction', @LockTimeout = 15000; SELECT @rc AS rc;`);
      if ((out.recordset[0]?.rc ?? -1) < 0) throw new Error('Busy. Try again in a moment.');
    };
    const cur = this.als.getStore();
    if (cur) { await lock(cur.tx); return fn(); }
    const tx = new sql.Transaction(await this.ready);
    await tx.begin(sql.ISOLATION_LEVEL.READ_COMMITTED);
    try {
      await lock(tx);
      const result = await this.als.run({ tx }, fn);
      await tx.commit();
      return result;
    } catch (e) {
      try { await tx.rollback(); } catch { /* already rolled back */ }
      throw e;
    }
  }

  async close() { await this.pool.close(); }
}
