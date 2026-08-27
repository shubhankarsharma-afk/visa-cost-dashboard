#!/usr/bin/env node
// Standalone update runner — the entry point for OS cron, GitHub Actions,
// Vercel Cron, cloud schedulers, or manual CLI runs. It performs ONE update
// and exits with a non-zero code on total failure (useful for CI alerting).
//
// Usage:
//   node scripts/run-update.js               # scheduled update
//   node scripts/run-update.js --type=manual # manual update
import { seed } from '../src/db/seed.js';
import { runUpdate } from '../src/services/update.js';
import { logger } from '../src/logger.js';

const typeArg = process.argv.find((a) => a.startsWith('--type='));
const type = typeArg ? typeArg.split('=')[1] : 'scheduled';

(async () => {
  try {
    seed(); // ensures tables + currency list exist (idempotent)
    const result = await runUpdate({ type });
    logger.info(`run-update result: ${JSON.stringify(result, null, 2)}`);
    // Non-zero exit only when nothing at all could be stored.
    process.exit(result.status === 'failed' ? 1 : 0);
  } catch (err) {
    logger.error('run-update fatal error:', err.message);
    process.exit(2);
  }
})();
