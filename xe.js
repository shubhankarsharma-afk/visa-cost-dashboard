// Provider: XE Currency Data API  (https://www.xe.com/xecurrencydata/)
// PAID. Requires an Account ID + API Key (HTTP Basic auth). No scraping.
//
// Endpoints (v1):
//   GET /convert_from.json?from=INR&to=AED,BHD,...&amount=1
//        -> { from:"INR", amount:1, timestamp:"...", to:[{quotecurrency:"AED", mid:0.0383}, ...] }
//        mid = units of quotecurrency per 1 INR  =>  INR per 1 X = 1 / mid.
//   GET /historic_rate.json?from=INR&to=AED&amount=1&date=YYYY-MM-DD
//        -> { to:[{quotecurrency, mid}], timestamp }
//
// NOTE: field names follow the published XE v1 spec. If XE changes them,
// adjust the two parse points below — nothing else in the app needs to change.
import { config } from '../config.js';
import { fetchJson } from './http.js';

export const id = 'xe';
export const label = 'XE Currency Data API (paid)';
export const supportsHistorical = true;

function authHeader() {
  const { accountId, apiKey } = config.provider.xe;
  const token = Buffer.from(`${accountId}:${apiKey}`).toString('base64');
  return { Authorization: `Basic ${token}` };
}

export function isConfigured() {
  return Boolean(config.provider.xe.accountId && config.provider.xe.apiKey);
}

export async function fetchLatest(base, codes) {
  if (!isConfigured()) throw new Error('XE provider not configured (set XE_ACCOUNT_ID and XE_API_KEY).');
  const to = codes.join(',');
  const url = `${config.provider.xe.baseUrl}/convert_from.json?from=${encodeURIComponent(base)}&to=${encodeURIComponent(to)}&amount=1`;
  const json = await fetchJson(url, { headers: authHeader() });
  if (!Array.isArray(json.to)) throw new Error('XE response missing "to" array.');
  const rates = {};
  for (const row of json.to) {
    const code = row.quotecurrency;
    const perBase = row.mid; // foreign units per 1 base
    if (perBase === undefined || perBase === null) continue;
    rates[code] = perBase === 0 ? null : 1 / perBase; // INR per 1 foreign unit
  }
  return {
    source: id,
    base,
    providerTimestamp: json.timestamp || null,
    rates,
  };
}

export async function fetchHistorical(base, code, date /* YYYY-MM-DD */) {
  if (!isConfigured()) throw new Error('XE provider not configured.');
  const url = `${config.provider.xe.baseUrl}/historic_rate.json?from=${encodeURIComponent(base)}&to=${encodeURIComponent(code)}&amount=1&date=${date}`;
  const json = await fetchJson(url, { headers: authHeader() });
  const row = Array.isArray(json.to) ? json.to[0] : null;
  if (!row || row.mid == null) throw new Error(`XE historic rate missing for ${code} on ${date}.`);
  return {
    source: id,
    base,
    date,
    rate: row.mid === 0 ? null : 1 / row.mid,
    providerTimestamp: json.timestamp || null,
  };
}
