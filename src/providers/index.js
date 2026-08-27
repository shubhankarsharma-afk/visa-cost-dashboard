// Provider registry + factory. To ADD a provider: create an adapter module
// that exports { id, label, supportsHistorical, isConfigured, fetchLatest,
// fetchHistorical } and register it in ADAPTERS below.
import * as erapi from './erapi.js';
import * as xe from './xe.js';
import * as exchangerateApi from './exchangerate-api.js';
import * as exchangeratehost from './exchangeratehost.js';
import { config } from '../config.js';
import { logger } from '../logger.js';

const ADAPTERS = {
  [erapi.id]: erapi,
  [xe.id]: xe,
  [exchangerateApi.id]: exchangerateApi,
  [exchangeratehost.id]: exchangeratehost,
};

export function getProvider(providerId) {
  const p = ADAPTERS[providerId];
  if (!p) throw new Error(`Unknown provider "${providerId}". Available: ${Object.keys(ADAPTERS).join(', ')}`);
  return p;
}

export function listProviders() {
  return Object.values(ADAPTERS).map((p) => ({
    id: p.id,
    label: p.label,
    supportsHistorical: p.supportsHistorical,
    configured: p.isConfigured(),
  }));
}

// Returns the ordered list of providers to try: primary, then fallback (if
// different and configured). Only configured providers are attempted.
export function getProviderChain() {
  const chain = [];
  const primary = getProvider(config.provider.primary);
  if (primary.isConfigured()) chain.push(primary);
  else logger.warn(`Primary provider "${primary.id}" is not configured; will use fallback.`);

  const fb = getProvider(config.provider.fallback);
  if (fb.id !== (chain[0]?.id) && fb.isConfigured()) chain.push(fb);

  if (chain.length === 0) {
    // Last resort: erapi is always configured (keyless).
    chain.push(getProvider('erapi'));
  }
  return chain;
}
