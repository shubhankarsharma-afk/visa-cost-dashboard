// REST API. All data is read from the database (the last successfully stored
// result) — endpoints never fabricate values and never trust the client clock.
import express from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { buildDashboard } from '../services/presenter.js';
import { runUpdate } from '../services/update.js';
import { getHistory, getCurrencyByCode, getRecentRuns } from '../db/index.js';
import { istDateString } from '../services/time.js';
import { saveVisaPrice, visaPriceHistory, visaCostSeries } from '../services/visa.js';

export const router = express.Router();

// ---- Dashboard snapshot (cards + table + status) ---------------------------
router.get('/dashboard', (req, res) => {
  try {
    res.json(buildDashboard());
  } catch (err) {
    logger.error('dashboard error', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---- Status only -----------------------------------------------------------
router.get('/status', (req, res) => {
  try {
    const d = buildDashboard();
    res.json({ meta: d.meta, status: d.status, providers: d.providers });
  } catch (err) {
    res.status(500).json({ error: 'internal_error' });
  }
});

// ---- Historical series for one currency ------------------------------------
// GET /api/history/:code?range=7|30|90|365  (or ?days=N, or ?from=YYYY-MM-DD)
router.get('/history/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 8);
  if (!/^[A-Z]{3,8}$/.test(code)) return res.status(400).json({ error: 'invalid_code' });
  const cur = getCurrencyByCode(code);
  if (!cur) return res.status(404).json({ error: 'unknown_currency' });

  let days = Number(req.query.days || req.query.range || 30);
  if (!Number.isFinite(days) || days <= 0) days = 30;
  days = Math.min(days, 3650);

  let sinceDate = req.query.from;
  if (!sinceDate) {
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - days);
    sinceDate = istDateString(since);
  }

  const series = getHistory(code, sinceDate).map((r) => ({
    date: r.rate_date,
    rate: r.rate,
    readable_value: r.rate != null ? r.rate * (cur.display_unit || 1) : null,
    abs_change: r.abs_change,
    pct_change: r.pct_change,
    source: r.data_source,
    status: r.status,
  }));

  res.json({
    code,
    country: cur.country,
    currency_name: cur.currency_name,
    display_unit: cur.display_unit,
    decimals: cur.decimals,
    since: sinceDate,
    points: series,
  });
});

// ---- Recent update runs (audit) --------------------------------------------
router.get('/logs', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 200);
  res.json({ runs: getRecentRuns(limit) });
});

// (Visa endpoints below)
// ============================================================================
//  VISA PRICE endpoints — completely separate from exchange-rate refresh.
//  Editing a visa price NEVER triggers an exchange-rate fetch, and vice versa.
// ============================================================================
const CODE_RE = /^[A-Z]{3,8}$/;

// Save/replace one visa price (creates a new version; keeps history).
router.post('/visa-prices/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 8);
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'invalid_code' });
  const price = req.body ? req.body.price : undefined;
  const result = saveVisaPrice(code, price, 'user');
  if (!result.ok) return res.status(400).json({ error: 'invalid_price', message: result.error });
  logger.info(`Visa price saved: ${code} = ${result.price.visa_price}`);
  res.json({ ok: true, code, price: result.price });
});

// Bulk save (first-run "Configure Visa Prices"). Body: { prices: { AED: 100, ... } }
router.post('/visa-prices', (req, res) => {
  const prices = (req.body && req.body.prices) || {};
  const saved = [];
  const errors = [];
  for (const [rawCode, val] of Object.entries(prices)) {
    const code = String(rawCode).toUpperCase();
    if (val === '' || val === null || val === undefined) continue; // skip blanks
    if (!CODE_RE.test(code)) { errors.push({ code, error: 'invalid_code' }); continue; }
    const r = saveVisaPrice(code, val, 'user');
    if (r.ok) saved.push({ code, price: r.price.visa_price });
    else errors.push({ code, error: r.error });
  }
  logger.info(`Bulk visa prices saved: ${saved.length}, errors: ${errors.length}`);
  res.json({ ok: errors.length === 0, saved, errors });
});

// Visa-price version history for a currency (with INR-at-change).
router.get('/visa-prices/:code/history', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 8);
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'invalid_code' });
  const cur = getCurrencyByCode(code);
  if (!cur) return res.status(404).json({ error: 'unknown_currency' });
  res.json({ code, country: cur.country, currency_name: cur.currency_name, versions: visaPriceHistory(code) });
});

// Historical INR VISA COST series: price-active-on-date x rate-on-date.
router.get('/visa-history/:code', (req, res) => {
  const code = String(req.params.code || '').toUpperCase().slice(0, 8);
  if (!CODE_RE.test(code)) return res.status(400).json({ error: 'invalid_code' });
  const cur = getCurrencyByCode(code);
  if (!cur) return res.status(404).json({ error: 'unknown_currency' });
  let days = Number(req.query.days || 30);
  if (!Number.isFinite(days) || days <= 0) days = 30;
  days = Math.min(days, 3650);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - days);
  const sinceDate = istDateString(since);
  const ratePoints = getHistory(code, sinceDate).map((r) => ({ date: r.rate_date, rate: r.rate }));
  res.json({
    code,
    country: cur.country,
    currency_name: cur.currency_name,
    display_unit: cur.display_unit,
    since: sinceDate,
    points: visaCostSeries(code, ratePoints),
  });
});

// ---- Manual refresh (rate-limited, marked as type=manual) ------------------
const refreshLimiter = rateLimit({
  windowMs: config.manualRefresh.minIntervalSeconds * 1000,
  max: 1,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'rate_limited', message: `Please wait before refreshing again.` },
});

router.post('/refresh', refreshLimiter, async (req, res) => {
  try {
    logger.info('Manual refresh requested');
    const result = await runUpdate({ type: 'manual' });
    res.json({ ok: result.status !== 'failed', update_type: 'manual', result });
  } catch (err) {
    logger.error('manual refresh error', err);
    res.status(500).json({ error: 'refresh_failed', message: err.message });
  }
});
