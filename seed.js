// Seeds/updates the currencies table from config/currencies.js. Idempotent.
import { TRACKED_CURRENCIES } from '../../config/currencies.js';
import { upsertCurrency } from './index.js';
import { migrate } from './migrate.js';
import { logger } from '../logger.js';

export function seed() {
  migrate();
  let n = 0;
  for (const c of TRACKED_CURRENCIES) {
    upsertCurrency({
      country: c.country,
      currency_name: c.currency_name,
      iso_code: c.iso_code,
      display_unit: c.display_unit ?? 1,
      decimals: c.decimals ?? 4,
      is_card: c.card ? 1 : 0,
      is_reference: c.reference ? 1 : 0,
      active: c.active ? 1 : 0,
    });
    n++;
  }
  logger.info(`Seeded/updated ${n} currencies from config.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
  process.exit(0);
}
