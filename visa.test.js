// Visa-price layer tests, including the required Day 1–5 end-to-end scenario.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'visa-test-'));
process.env.DB_PATH = path.join(TMP, 'test.db');

let seed, runUpdate, makeProvider, DAY1, DAY2;
let saveVisaPrice, computeVisaForCurrency, validateVisaPrice, visaPriceHistory;
let getVisaPriceOnDate, buildDashboard;

// Helper: run an update at a shifted clock so it lands on a distinct rate_date.
async function updateOn(offsetDays, day) {
  const Real = Date;
  const t = Real.now() + offsetDays * 86400000;
  global.Date = class extends Real { constructor(...a){ super(...(a.length?a:[t])); } static now(){ return t; } };
  try { return await runUpdate({ type: 'scheduled', providers: [makeProvider(day)] }); }
  finally { global.Date = Real; }
}
async function setPriceOn(offsetDays, code, price) {
  const Real = Date;
  const t = Real.now() + offsetDays * 86400000;
  global.Date = class extends Real { constructor(...a){ super(...(a.length?a:[t])); } static now(){ return t; } };
  try { return saveVisaPrice(code, price, 'user'); }
  finally { global.Date = Real; }
}

before(async () => {
  ({ seed } = await import('../src/db/seed.js'));
  ({ runUpdate } = await import('../src/services/update.js'));
  ({ saveVisaPrice, computeVisaForCurrency, validateVisaPrice, visaPriceHistory } = await import('../src/services/visa.js'));
  ({ getVisaPriceOnDate } = await import('../src/db/index.js'));
  ({ buildDashboard } = await import('../src/services/presenter.js'));
  ({ makeProvider, DAY1, DAY2 } = await import('./fixtures/sample-rates.js'));
  seed();
});
after(() => { try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {} });

test('validation rejects bad prices, accepts commas', () => {
  assert.equal(validateVisaPrice('').ok, false);
  assert.equal(validateVisaPrice('-5').ok, false);
  assert.equal(validateVisaPrice('abc').ok, false);
  assert.equal(validateVisaPrice('1,500,000').ok, true);
  assert.equal(validateVisaPrice('1,500,000').value, 1500000);
});

test('not configured => no cost, not zero', () => {
  const v = computeVisaForCurrency('AED');
  assert.equal(v.price_configured, false);
  assert.equal(v.inr_cost, null); // NOT 0
  assert.equal(v.price_status, 'Price Not Configured');
});

test('Day 1: set 100 AED with rate ~26 => cost ~2606', async () => {
  await updateOn(-1, DAY1);            // yesterday's rates
  setPriceOn(-1, 'AED', 100);          // user sets price
  const v = computeVisaForCurrency('AED');
  assert.equal(v.visa_price, 100);
  assert.equal(v.price_configured, true);
  assert.ok(v.inr_cost > 2600 && v.inr_cost < 2610, `expected ~2606, got ${v.inr_cost}`);
});

test('Day 2: rate changes, visa price UNCHANGED, INR cost recalculated', async () => {
  await updateOn(0, DAY2);             // today's (different) rates
  const v = computeVisaForCurrency('AED');
  assert.equal(v.visa_price, 100, 'visa price must not change when rate changes');
  // DAY2 AED rate = 1/0.038300 = 26.109 => cost 2610.9
  assert.ok(v.inr_cost > 2609 && v.inr_cost < 2612, `expected ~2611, got ${v.inr_cost}`);
  assert.equal(v.change_available, true);
  assert.ok(Math.abs(v.inr_change - (v.inr_cost - v.prev_inr_cost)) < 1e-6);
  assert.equal(v.price_change_flag, false, 'price did not change, so no price-change flag');
});

test('Editing price creates a new version; history preserved; immediate recalc', async () => {
  const before = computeVisaForCurrency('AED').inr_cost;
  setPriceOn(0, 'AED', 125);           // user changes price today
  const v = computeVisaForCurrency('AED');
  assert.equal(v.visa_price, 125);
  assert.ok(v.inr_cost > before, 'higher price => higher INR cost immediately');
  // 125 * 26.109 ~ 3263
  assert.ok(v.inr_cost > 3260 && v.inr_cost < 3266, `expected ~3264, got ${v.inr_cost}`);

  const hist = visaPriceHistory('AED');
  assert.equal(hist.length, 2, 'two versions retained');
  assert.equal(hist[0].visa_price, 125);
  assert.equal(hist[0].is_active, true);
  assert.equal(hist[1].visa_price, 100);
  assert.equal(hist[1].is_active, false);
});

test('Historical price-on-date uses the version active THEN, not today', () => {
  // Yesterday the active price was 100 (changed to 125 today).
  const yStr = new Date(Date.now() - 86400000).toLocaleString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 10);
  const vOnY = getVisaPriceOnDate('AED', yStr);
  assert.equal(vOnY.visa_price, 100, 'historical lookup must return the price active on that date');
});

test('API failure does not erase visa prices or rates', async () => {
  const priceBefore = computeVisaForCurrency('AED').visa_price;
  await updateOn(0, DAY2);             // succeed first (baseline)
  const res = await runUpdate({ type: 'scheduled', providers: [makeProvider(DAY2, { fail: true })] });
  assert.equal(res.status, 'failed');
  const v = computeVisaForCurrency('AED');
  assert.equal(v.visa_price, priceBefore, 'visa price retained after failed rate update');
  assert.ok(v.inr_cost != null, 'still shows INR cost from last good rate');
});

test('Dashboard payload exposes visa fields + summary', () => {
  const d = buildDashboard();
  const aed = d.currencies.find((c) => c.code === 'AED');
  assert.equal(aed.price_configured, true);
  assert.equal(aed.visa_price, 125);
  assert.ok(aed.inr_cost > 0);
  assert.ok(d.visa_summary.configured >= 1);
  assert.equal(typeof d.visa_summary.total_inr_today, 'number');
});
