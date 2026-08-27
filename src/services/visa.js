// Visa-price business logic.
//
// CORE RULE:
//   - Visa price (foreign currency) = source of truth, user-maintained, persistent.
//   - INR visa cost = DERIVED = visa_price x latest successful exchange rate.
//   - Exchange rate changing NEVER changes the visa price; it only changes the
//     derived INR cost. The visa price changes ONLY on explicit user save.
import {
  getActiveVisaPrice,
  getAllActiveVisaPrices,
  getVisaPriceHistory,
  getVisaPriceOnDate,
  setVisaPrice as dbSetVisaPrice,
  getCurrencyByCode,
  getLatestGoodRate,
  getPreviousGoodRate,
  getRateForDate,
} from '../db/index.js';
import { istDateString, istHuman } from './time.js';

// Validate a user-entered visa price. Returns { ok, value, error }.
export function validateVisaPrice(input) {
  if (input === null || input === undefined || String(input).trim() === '') {
    return { ok: false, error: 'Visa price is required.' };
  }
  // strip commas/spaces so "1,500,000" is accepted
  const cleaned = String(input).replace(/[,\s]/g, '');
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return { ok: false, error: 'Visa price must be a number.' };
  if (n <= 0) return { ok: false, error: 'Visa price must be greater than zero.' };
  if (n > 1e12) return { ok: false, error: 'Visa price is unreasonably large.' };
  return { ok: true, value: n };
}

// Save a new visa price for a currency (creates a new version).
export function saveVisaPrice(code, rawPrice, changedBy = 'user') {
  const cur = getCurrencyByCode(code);
  if (!cur) return { ok: false, error: `Unknown currency ${code}` };
  const v = validateVisaPrice(rawPrice);
  if (!v.ok) return v;
  const now = new Date();
  const row = dbSetVisaPrice({
    country: cur.country,
    currency_code: code,
    visa_price: v.value,
    changed_by: changedBy,
    nowIso: now.toISOString(),
    todayDate: istDateString(now),
    nowIst: istHuman(now),
  });
  return { ok: true, price: row, currency: cur };
}

// Compute the visa view for one currency: active price, latest rate, derived
// INR cost, and day-over-day change of the INR cost (distinguishing exchange
// movement from an explicit price change).
export function computeVisaForCurrency(code) {
  const cur = getCurrencyByCode(code);
  const active = getActiveVisaPrice(code);
  const latestRate = getLatestGoodRate(code);

  const out = {
    code,
    country: cur ? cur.country : code,
    currency_name: cur ? cur.currency_name : code,
    display_unit: cur ? cur.display_unit : 1,
    decimals: cur ? cur.decimals : 4,

    visa_price: active ? active.visa_price : null,
    price_configured: !!active,
    price_status: active ? 'Price Configured' : 'Price Not Configured',
    price_changed_at: active ? active.changed_at : null,
    price_changed_at_ist: active ? active.changed_at_ist : null,

    rate: latestRate ? latestRate.rate : null,
    rate_date: latestRate ? latestRate.rate_date : null,

    inr_cost: null,          // derived: visa_price x rate
    prev_inr_cost: null,
    inr_change: null,
    inr_pct_change: null,
    change_available: false,
    price_change_flag: false,   // true if the price itself changed vs previous day
    prev_visa_price: null,
    direction: 'neutral',
  };

  if (active && latestRate && latestRate.rate != null) {
    out.inr_cost = active.visa_price * latestRate.rate;

    // Previous-day comparison uses the previous stored exchange-rate date and
    // the visa price that was active on THAT date.
    const prevRate = getPreviousGoodRate(code, latestRate.rate_date);
    if (prevRate && prevRate.rate != null) {
      const priceThen = getVisaPriceOnDate(code, prevRate.rate_date);
      if (priceThen) {
        out.prev_visa_price = priceThen.visa_price;
        out.prev_inr_cost = priceThen.visa_price * prevRate.rate;
        out.inr_change = out.inr_cost - out.prev_inr_cost;
        out.inr_pct_change = out.prev_inr_cost !== 0
          ? (out.inr_change / out.prev_inr_cost) * 100
          : null;
        out.change_available = true;
        out.price_change_flag = priceThen.visa_price !== active.visa_price;
        if (out.inr_change > 0.0001) out.direction = 'up';
        else if (out.inr_change < -0.0001) out.direction = 'down';
      }
    }
  }
  return out;
}

// Visa-price version history for a currency, annotated with the INR equivalent
// at the time of each change (price x rate on that date — historical, not today's).
export function visaPriceHistory(code) {
  const versions = getVisaPriceHistory(code);
  return versions.map((v) => {
    const rateThen = getRateForDate(code, v.effective_from_date);
    return {
      visa_price: v.visa_price,
      currency_code: v.currency_code,
      effective_from: v.effective_from,
      effective_from_date: v.effective_from_date,
      effective_until_date: v.effective_until_date,
      is_active: !!v.is_active,
      status: v.status,
      changed_by: v.changed_by,
      changed_at_ist: v.changed_at_ist,
      inr_at_change: rateThen && rateThen.rate != null ? v.visa_price * rateThen.rate : null,
      rate_at_change: rateThen ? rateThen.rate : null,
    };
  });
}

// Historical INR visa-cost series for charting:
//   for each stored exchange-rate date, cost = (price active that date) x (rate that date).
// Uses historical price AND historical rate — never today's price.
export function visaCostSeries(code, ratePoints) {
  return ratePoints.map((p) => {
    const priceThen = getVisaPriceOnDate(code, p.date);
    const cost = priceThen && p.rate != null ? priceThen.visa_price * p.rate : null;
    return {
      date: p.date,
      rate: p.rate,
      visa_price: priceThen ? priceThen.visa_price : null,
      inr_cost: cost,
    };
  });
}

export { getAllActiveVisaPrices };
