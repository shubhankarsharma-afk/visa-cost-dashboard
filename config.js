// Central runtime configuration, loaded from environment variables.
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}
function bool(v, def) {
  if (v === undefined || v === null || v === '') return def;
  return String(v).toLowerCase() === 'true';
}

export const config = {
  root: ROOT,
  port: num(process.env.PORT, 3000),
  nodeEnv: process.env.NODE_ENV || 'development',
  baseCurrency: process.env.BASE_CURRENCY || 'INR',

  dbPath: process.env.DB_PATH || path.join(ROOT, 'data', 'currency.db'),

  schedule: {
    timezone: process.env.SCHEDULE_TIMEZONE || 'Asia/Kolkata',
    cron: process.env.SCHEDULE_CRON || '0 9 * * *',
    enableInProcess: bool(process.env.ENABLE_INPROCESS_SCHEDULER, true),
  },

  provider: {
    primary: process.env.PROVIDER || 'erapi',
    fallback: process.env.FALLBACK_PROVIDER || 'erapi',
    timeoutMs: num(process.env.PROVIDER_TIMEOUT_MS, 15000),
    retries: num(process.env.PROVIDER_RETRIES, 3),
    retryDelayMs: num(process.env.PROVIDER_RETRY_DELAY_MS, 5000),

    erapi: {
      baseUrl: process.env.ERAPI_BASE_URL || 'https://open.er-api.com/v6',
    },
    xe: {
      accountId: process.env.XE_ACCOUNT_ID || '',
      apiKey: process.env.XE_API_KEY || '',
      baseUrl: process.env.XE_BASE_URL || 'https://xecdapi.xe.com/v1',
    },
    exchangerateApi: {
      apiKey: process.env.EXCHANGERATE_API_KEY || '',
      baseUrl: process.env.EXCHANGERATE_API_BASE_URL || 'https://v6.exchangerate-api.com/v6',
    },
    exchangeratehost: {
      apiKey: process.env.EXCHANGERATEHOST_API_KEY || '',
      baseUrl: process.env.EXCHANGERATEHOST_BASE_URL || 'https://api.exchangerate.host',
    },
  },

  validation: {
    flagMovementPercent: num(process.env.FLAG_MOVEMENT_PERCENT, 15),
    rejectMovementPercent: num(process.env.REJECT_MOVEMENT_PERCENT, 60),
  },

  manualRefresh: {
    minIntervalSeconds: num(process.env.MANUAL_REFRESH_MIN_INTERVAL_SECONDS, 60),
  },

  referenceCurrencies: (process.env.REFERENCE_CURRENCIES || 'USD,EUR')
    .split(',')
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean),
};
