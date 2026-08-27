// Provider: ExchangeRate-API v6 (https://www.exchangerate-api.com/) — KEYED.
// Supports current and historical. Good for historical backfill.
//
//   GET /v6/{KEY}/latest/INR
//       -> { result:"success", time_last_update_unix, conversion_rates:{ "AED":0.0383, ... } }
//   GET /v6/{KEY}/history/INR/{YEAR}/{MONTH}/{DAY}   (paid plans)
//       -> { result:"success", conversion_rates:{...} }
import { config } from '../config.js';
import { fetchJson, redact } from './http.js';

export const id = 'exchangerate-api';
export const label = 'ExchangeRate-API v6 (keyed)';
export const supportsHistorical = true;

export function isConfigured() {
  return Boolean(config.provider.exchangerateApi.apiKey);
}

function base_() {
  return `${config.provider.exchangerateApi.baseUrl}/${config.provider.exchangerateApi.apiKey}`;
}

export async function fetchLatest(base, codes) {
  if (!isConfigured()) throw new Error('exchangerate-api not configured (set EXCHANGERATE_API_KEY).');
  const url = `${base_()}/latest/${encodeURIComponent(base)}`;
  const json = await fetchJson(url);
  if (json.result !== 'success' || !json.conversion_rates) {
    throw new Error(`exchangerate-api error: ${json['error-type'] || redact(JSON.stringify(json)).slice(0, 200)}`);
  }
  const rates = {};
  for (const code of codes) {
    const perBase = json.conversion_rates[code];
    if (perBase === undefined || perBase === null) continue;
    rates[code] = perBase === 0 ? null : 1 / perBase;
  }
  return {
    source: id,
    base,
    providerTimestamp: json.time_last_update_unix
      ? new Date(json.time_last_update_unix * 1000).toISOString()
      : null,
    rates,
  };
}

export async function fetchHistorical(base, code, date /* YYYY-MM-DD */) {
  if (!isConfigured()) throw new Error('exchangerate-api not configured.');
  const [y, m, d] = date.split('-');
  const url = `${base_()}/history/${encodeURIComponent(base)}/${Number(y)}/${Number(m)}/${Number(d)}`;
  const json = await fetchJson(url);
  if (json.result !== 'success' || !json.conversion_rates) {
    throw new Error(`exchangerate-api history error: ${json['error-type'] || 'unknown'}`);
  }
  const perBase = json.conversion_rates[code];
  return {
    source: id,
    base,
    date,
    rate: perBase ? 1 / perBase : null,
    providerTimestamp: null,
  };
}
