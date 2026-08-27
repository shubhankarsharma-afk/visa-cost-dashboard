// Provider: exchangerate.host (apilayer) — KEYED.
//   GET /live?access_key=KEY&source=INR&currencies=AED,BHD,...
//       -> { success:true, timestamp, source:"INR", quotes:{ "INRAED":0.0383, ... } }
//   GET /historical?access_key=KEY&date=YYYY-MM-DD&source=INR&currencies=AED
import { config } from '../config.js';
import { fetchJson } from './http.js';

export const id = 'exchangeratehost';
export const label = 'exchangerate.host (keyed)';
export const supportsHistorical = true;

export function isConfigured() {
  return Boolean(config.provider.exchangeratehost.apiKey);
}

function key() {
  return config.provider.exchangeratehost.apiKey;
}

export async function fetchLatest(base, codes) {
  if (!isConfigured()) throw new Error('exchangeratehost not configured (set EXCHANGERATEHOST_API_KEY).');
  const url = `${config.provider.exchangeratehost.baseUrl}/live?access_key=${key()}&source=${encodeURIComponent(base)}&currencies=${encodeURIComponent(codes.join(','))}`;
  const json = await fetchJson(url);
  if (!json.success || !json.quotes) {
    throw new Error(`exchangeratehost error: ${json.error ? JSON.stringify(json.error) : 'unknown'}`);
  }
  const rates = {};
  for (const code of codes) {
    const perBase = json.quotes[`${base}${code}`];
    if (perBase === undefined || perBase === null) continue;
    rates[code] = perBase === 0 ? null : 1 / perBase;
  }
  return {
    source: id,
    base,
    providerTimestamp: json.timestamp ? new Date(json.timestamp * 1000).toISOString() : null,
    rates,
  };
}

export async function fetchHistorical(base, code, date) {
  if (!isConfigured()) throw new Error('exchangeratehost not configured.');
  const url = `${config.provider.exchangeratehost.baseUrl}/historical?access_key=${key()}&date=${date}&source=${encodeURIComponent(base)}&currencies=${encodeURIComponent(code)}`;
  const json = await fetchJson(url);
  if (!json.success || !json.quotes) throw new Error('exchangeratehost historical error.');
  const perBase = json.quotes[`${base}${code}`];
  return { source: id, base, date, rate: perBase ? 1 / perBase : null, providerTimestamp: null };
}
