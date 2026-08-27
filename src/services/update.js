// The core update job: fetch -> validate -> compute change -> store -> log.
// Called by the scheduler, the standalone script, and the manual-refresh route.
import { config } from '../config.js';
import { logger } from '../logger.js';
import { getProviderChain } from '../providers/index.js';
import {
  getActiveCurrencies,
  getPreviousGoodRate,
  insertRate,
  insertUpdateLog,
} from '../db/index.js';
import { validateRate, validateProviderTimestamp } from './validate.js';
import { istDateString, istHuman } from './time.js';

/**
 * Run one update.
 * @param {{ type?: 'scheduled'|'manual' }} opts
 * @returns {Promise<object>} summary
 */
export async function runUpdate({ type = 'scheduled', providers = null } = {}) {
  const started = Date.now();
  const base = config.baseCurrency;
  const rateDate = istDateString();
  const fetchedTimestamp = new Date().toISOString();

  const currencies = getActiveCurrencies().filter((c) => c.iso_code !== base);
  const requestCodes = currencies.map((c) => c.iso_code);

  logger.info(`Update start [${type}] date=${rateDate} base=${base} currencies=${requestCodes.length}`);

  // ---- Fetch from provider chain (primary -> fallback) ---------------------
  let fetched = null;
  let usedSource = null;
  let fetchError = null;
  const chain = providers || getProviderChain();
  for (const provider of chain) {
    try {
      logger.info(`Trying provider "${provider.id}"...`);
      fetched = await provider.fetchLatest(base, requestCodes);
      usedSource = provider.id;
      break;
    } catch (err) {
      fetchError = err;
      logger.warn(`Provider "${provider.id}" failed: ${err.message}`);
    }
  }

  // ---- Total failure: keep old data, log failure, do NOT write bad rows -----
  if (!fetched) {
    const msg = fetchError ? fetchError.message : 'All providers failed';
    logger.error(`Update FAILED — no provider returned data. ${msg}`);
    insertUpdateLog({
      execution_timestamp: fetchedTimestamp,
      execution_timestamp_ist: istHuman(),
      rate_date: rateDate,
      execution_type: type,
      currencies_requested: requestCodes.length,
      currencies_successful: 0,
      currencies_failed: requestCodes.length,
      currencies_flagged: 0,
      data_source: null,
      status: 'failed',
      error_message: msg,
      duration_ms: Date.now() - started,
    });
    return {
      status: 'failed',
      rateDate,
      type,
      error: msg,
      requested: requestCodes.length,
      successful: 0,
      failed: requestCodes.length,
      flagged: 0,
    };
  }

  const tsCheck = validateProviderTimestamp(fetched.providerTimestamp);
  if (tsCheck.warn) logger.warn(`Provider timestamp: ${tsCheck.warn}`);

  // ---- Validate + store each currency --------------------------------------
  let successful = 0;
  let failed = 0;
  let flagged = 0;
  const results = [];

  for (const cur of currencies) {
    const code = cur.iso_code;
    const rate = fetched.rates[code];
    const prev = getPreviousGoodRate(code, rateDate);
    const previousRate = prev ? prev.rate : null;

    const v = validateRate({
      code: rate === undefined ? code : code, // erapi/xe already keyed by requested code
      requestedCode: code,
      rate,
      previousRate,
      providerTimestamp: fetched.providerTimestamp,
    });

    if (!v.ok) {
      failed++;
      // Record a 'failed' row so the failure is auditable, but it will NOT be
      // used as "latest good" data (queries exclude status='failed').
      insertRate({
        currency_code: code,
        base_currency: base,
        rate_date: rateDate,
        rate: Number.isFinite(rate) ? rate : null,
        previous_rate: previousRate,
        abs_change: null,
        pct_change: null,
        rate_timestamp: fetched.providerTimestamp,
        fetched_timestamp: fetchedTimestamp,
        update_type: type,
        data_source: usedSource,
        status: 'failed',
        flagged_reason: v.reason,
      });
      results.push({ code, status: 'failed', reason: v.reason });
      logger.warn(`  ${code}: FAILED — ${v.reason}`);
      continue;
    }

    const absChange = previousRate != null ? rate - previousRate : null;
    const pctChange = previousRate != null && previousRate !== 0
      ? ((rate - previousRate) / previousRate) * 100
      : null;

    insertRate({
      currency_code: code,
      base_currency: base,
      rate_date: rateDate,
      rate,
      previous_rate: previousRate,
      abs_change: absChange,
      pct_change: pctChange,
      rate_timestamp: fetched.providerTimestamp,
      fetched_timestamp: fetchedTimestamp,
      update_type: type,
      data_source: usedSource,
      status: v.status, // success | flagged
      flagged_reason: v.reason,
    });

    if (v.status === 'flagged') {
      flagged++;
      logger.warn(`  ${code}: FLAGGED — ${v.reason}`);
    } else {
      successful++;
    }
    results.push({ code, status: v.status, rate, previousRate, absChange, pctChange });
  }

  const overall = failed === requestCodes.length ? 'failed' : failed > 0 ? 'partial' : 'success';

  insertUpdateLog({
    execution_timestamp: fetchedTimestamp,
    execution_timestamp_ist: istHuman(),
    rate_date: rateDate,
    execution_type: type,
    currencies_requested: requestCodes.length,
    currencies_successful: successful + flagged, // flagged values are still stored/usable
    currencies_failed: failed,
    currencies_flagged: flagged,
    data_source: usedSource,
    status: overall,
    error_message: overall === 'success' ? null : `${failed} currency(ies) failed validation`,
    duration_ms: Date.now() - started,
  });

  logger.info(
    `Update done [${type}] source=${usedSource} ok=${successful} flagged=${flagged} failed=${failed} in ${Date.now() - started}ms`
  );

  return {
    status: overall,
    rateDate,
    type,
    source: usedSource,
    requested: requestCodes.length,
    successful,
    flagged,
    failed,
    results,
  };
}
