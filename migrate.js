// Applies schema.sql to create tables + indexes. Idempotent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getDb } from './index.js';
import { logger } from '../logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  getDb().exec(sql);
  logger.info('Database migration complete (tables + indexes ensured).');
}

// Run when invoked directly: `npm run migrate`
if (import.meta.url === `file://${process.argv[1]}`) {
  migrate();
  process.exit(0);
}
