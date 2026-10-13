/* Builds the services from configuration: Azure SQL + Azure Communication Services in Azure, memory locally. */
import { GrantedService, MemoryStore, nullMailer, seedDemo, demoAnchor, type Mailer, type Store } from '@granted/services';
import { AcsMailer } from './acs-mailer';
import type { ApiConfig } from './config';
import { SqlStore } from './sql-store';

export async function createServices(cfg: ApiConfig, log: (m: string) => void = console.error): Promise<GrantedService> {
  let store: Store;
  if (cfg.store === 'sql') store = new SqlStore({ server: cfg.sqlServer, database: cfg.sqlDatabase, connectionString: cfg.sqlConnectionString });
  else {
    const mem = new MemoryStore();
    if (cfg.seedDemo) await seedDemo(mem, demoAnchor(new Date()), 100000);
    store = mem;
  }
  let mailer: Mailer = nullMailer;
  if (cfg.mailFrom && (cfg.acsEndpoint || cfg.acsConnectionString)) mailer = new AcsMailer(cfg.mailFrom, { endpoint: cfg.acsEndpoint, connectionString: cfg.acsConnectionString }, log);
  else mailer = { async send(m) { log('[mail not configured] to=' + m.to + ' subject=' + m.subject); } };
  return new GrantedService({
    store, mailer,
    config: {
      adminCodeHash: cfg.adminCodeHash,
      passwordIterations: 600000,
      exposeCodes: cfg.exposeCodes,
      storeAccountMail: false,
      appUrl: cfg.appUrl,
      localAuth: cfg.authMode === 'local',
    },
  });
}
