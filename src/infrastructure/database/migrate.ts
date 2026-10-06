import { Migrator } from 'kysely/migration';
import { createDb } from './db.js';
import * as initial from './migrations/0001_initial.js';
import { logger } from '../logging/logger.js';

const db = createDb();

const migrator = new Migrator({
  db,
  provider: {
    async getMigrations() {
      return { '0001_initial': initial };
    },
  },
});

const { error, results } = await migrator.migrateToLatest();
for (const r of results ?? []) {
  if (r.status === 'Success') logger.info(`migration ${r.migrationName} applied`);
  else if (r.status === 'Error') logger.error(`migration ${r.migrationName} failed`);
}

await db.destroy();
if (error !== undefined) {
  logger.error({ error }, 'migration run failed');
  process.exit(1);
}
