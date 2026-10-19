#!/usr/bin/env node
/*
 * Sets up the Granted database: runs db/migrations in order and creates the
 * Function App's least-privilege database user. Safe to run again: the schema
 * is created only once (granted.schema_version) and 002 checks before creating.
 *
 * Signs in to Azure SQL with a Microsoft Entra access token (no SQL password exists):
 *
 *   SQL_SERVER=sql-....database.windows.net SQL_DATABASE=granted \
 *   SQL_TOKEN=$(az account get-access-token --resource https://database.windows.net/ --query accessToken -o tsv) \
 *   node tools/migrate.mjs --app func-granted-pilot-xxxx [--dir migrations]
 *
 * setup/azure-setup.sh runs this for you. Runs from the deployment package (granted-azure.zip),
 * which has mssql in node_modules, or from apps/api in the repository after npm install.
 */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sql from 'mssql';

const here = dirname(fileURLToPath(import.meta.url));
const arg = (name) => { const i = process.argv.indexOf('--' + name); return i > 0 ? process.argv[i + 1] : undefined; };
const appName = arg('app') || process.env.FUNCTION_APP_NAME;
const dir = resolve(arg('dir') || [join(here, '..', 'migrations'), join(here, '..', '..', '..', 'db', 'migrations')].find((d) => existsSync(d)) || '.');
const { SQL_SERVER: server, SQL_DATABASE: database = 'granted', SQL_TOKEN: token } = process.env;

if (!server || !token || !appName) {
  console.error('Needs SQL_SERVER, SQL_TOKEN (and optionally SQL_DATABASE) in the environment and --app <function app name>.');
  process.exit(2);
}
if (!/^[A-Za-z0-9-]{2,60}$/.test(appName)) { console.error('That Function App name looks wrong: ' + appName); process.exit(2); }

const files = readdirSync(dir).filter((f) => /^\d{3}_.*\.sql$/.test(f)).sort();
if (!files.length) { console.error('No migrations found in ' + dir); process.exit(2); }

const pool = await connect();
try {
  const has = await pool.request().query("SELECT CASE WHEN OBJECT_ID(N'granted.schema_version') IS NULL THEN 0 ELSE 1 END AS ok");
  let version = 0;
  if (has.recordset[0].ok) version = (await pool.request().query('SELECT ISNULL(MAX(version), 0) AS v FROM granted.schema_version')).recordset[0].v;
  for (const f of files) {
    const n = Number(f.slice(0, 3));
    const text = readFileSync(join(dir, f), 'utf8').replaceAll('<function-app-name>', appName);
    // 001 creates the schema (once). Later files are written to be safe to run again.
    if (n === 1 && version >= 1) { console.log('  ' + f + ': already done'); continue; }
    for (const batch of text.split(/^\s*GO\s*$/im).map((b) => b.trim()).filter(Boolean)) await pool.request().batch(batch);
    console.log('  ' + f + ': done');
  }
  console.log('Database ready.');
} finally {
  await pool.close();
}

async function connect() {
  // Serverless databases can take up to a minute to wake: try for about two minutes.
  let last;
  for (let i = 0; i < 8; i++) {
    try {
      return await sql.connect({
        server, database, port: 1433,
        authentication: { type: 'azure-active-directory-access-token', options: { token } },
        options: { encrypt: true, trustServerCertificate: false },
        connectionTimeout: 30000, requestTimeout: 120000,
      });
    } catch (e) {
      last = e;
      console.error('  waiting for the database (' + (e && e.message ? e.message.split('\n')[0] : e) + ')');
      await new Promise((r) => setTimeout(r, 15000));
    }
  }
  throw last;
}
