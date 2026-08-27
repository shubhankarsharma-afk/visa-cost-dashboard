// Provider: open.er-api.com (ExchangeRate-API open endpoint).
// KEYLESS. Returns real live rates for 160+ currencies. Default provider.
//
// Response shape (base = INR):
//   { result:"success", time_last_update_unix, time_last_update_utc,
//     base_code:"INR", rates:{ "AED":0.0383, ... } }
//   where rates[X] = units of X per 1 INR.  =>  INR per 1 X = 1 / rates[X].
import { config } from '../config.js';
import { fetchJson } from './http.js';

export const id = 'erapi';
export const label = 'open.er-api.com (ExchangeRate-API, keyless)';
export const supportsHistorical = false; // open endpoint has no historical route

export function isConfigured() {
  return true; // no key required
}

export async function fetchLatest(base, codes) {
  const url = `${config.provider.erapi.baseUrl}/latest/${encodeURIComponent(base)}`;
  const json = await fetchJson(url);
  if (json.result !== 'success' || !json.rates) {
    throw new Error(`erapi returned non-success: ${json['error-type'] || JSON.stringify(json).slice(0, 200)}`);
  }
  const rates = {};
  for (const code of codes) {
    const perBase = json.rates[code]; // foreign units per 1 INR
    if (perBase === undefined || perBase === null) continue; // missing -> validated later
    rates[code] = perBase === 0 ? null : 1 / perBase; // INR per 1 foreign unit
  }
  return {
    source: id,
    base,
    providerTimestamp: json.time_last_update_utc
      ? new Date(json.time_last_update_unix * 1000).toISOString()
      : null,
    rates,
  };
}

// Not supported on the keyless open endpoint.
export async function fetchHistorical() {
  throw new Error('Historical data is not available on the keyless open.er-api.com endpoint. Use a keyed provider (exchangerate-api or xe) for backfill.');
}
