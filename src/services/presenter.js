// Builds the JSON payloads the frontend consumes. All display formatting that
// needs server-side truth (timestamps, statuses) is computed here; the browser
// never invents a "last updated" time.
import { config } from '../config.js';
import {
  getActiveCurrencies,
  getLatestRatesAll,
  getLastSuccessfulRun,
  getLastRun,
} from '../db/index.js';
import { listProviders } from '../providers/index.js';
import { nextScheduledRun, istHuman } from './time.js';
import { computeVisaForCurrency } from './visa.js';

// Round to a sensible number of decimals for the readable conversion value.
function readableDecimals(unitValue) {
  if (unitValue >= 100) return 2;
  if (unitValue >= 1) return 2;
  if (unitValue >= 0.01) return 4;
  return 6;
}

export function buildDashboard() {
  const currencies = getActiveCurrencies();
  const latest = getLatestRatesAll();
  const byCode = new Map(latest.map((r) => [r.currency_code, r]));

  const rows = currencies
    .filter((c) => c.iso_code !== config.baseCurrency)
    .map((c) => {
      const r = byCode.get(c.iso_code);
      const hasData = !!r && r.rate != null;
      const rate = hasData ? r.rate : null;
      const unit = c.display_unit || 1;
      const readableValue = hasData ? rate * unit : null;

      let direction = 'neutral';
      if (r && r.pct_change != null) {
        if (r.pct_change > 0.001) direction = 'up';
        else if (r.pct_change < -0.001) direction = 'down';
      }

      // ---- Visa layer (derived INR cost = visa price x latest rate) --------
      const visa = computeVisaForCurrency(c.iso_code);

      return {
        country: c.country,
        currency_name: c.currency_name,
        code: c.iso_code,
        is_card: !!c.is_card,
        is_reference: !!c.is_reference,
        decimals: c.decimals,
        display_unit: unit,
        readable_decimals: readableDecimals(readableValue ?? 1),

        rate,                                   // INR per 1 foreign unit (full precision)
        readable_value: readableValue,          // INR per display_unit foreign units
        previous_rate: r ? r.previous_rate : null,
        abs_change: r ? r.abs_change : null,
        pct_change: r ? r.pct_change : null,
        direction,

        rate_date: r ? r.rate_date : null,
        rate_timestamp: r ? r.rate_timestamp : null,
        data_source: r ? r.data_source : null,
        record_status: r ? r.status : null,     // success | flagged | (no data)
        flagged_reason: r ? r.flagged_reason : null,
        has_data: hasData,
        change_available: !!(r && r.previous_rate != null),

        // ---- Visa fields -----------------------------------------------------
        visa_price: visa.visa_price,                 // foreign currency (source of truth)
        price_configured: visa.price_configured,
        price_status: visa.price_status,             // 'Price Configured' | 'Price Not Configured'
        price_changed_at_ist: visa.price_changed_at_ist,
        inr_cost: visa.inr_cost,                     // DERIVED = visa_price x rate
        prev_inr_cost: visa.prev_inr_cost,
        inr_change: visa.inr_change,                 // today's INR cost - previous day's
        inr_pct_change: visa.inr_pct_change,
        visa_change_available: visa.change_available,
        visa_direction: visa.direction,              // up | down | neutral (of INR cost)
        price_change_flag: visa.price_change_flag,   // true if the price itself changed
        prev_visa_price: visa.prev_visa_price,
      };
    });

  const lastSuccess = getLastSuccessfulRun();
  const lastRun = getLastRun();
  const next = nextScheduledRun();

  // System status: green = last run succeeded; yellow = have old good data but
  // latest run failed/pending; red = update failed and (implicitly) shown.
  let systemStatus = 'red';
  let statusLabel = 'Update Failed';
  if (lastSuccess) {
    if (lastRun && lastRun.id === lastSuccess.id) {
      systemStatus = 'green';
      statusLabel = 'Live / Successfully Updated';
    } else {
      systemStatus = 'yellow';
      statusLabel = 'Last successful update available — latest update did not fully succeed';
    }
  } else if (!lastRun) {
    systemStatus = 'yellow';
    statusLabel = 'No update has run yet';
  }

  const isStale = !(lastRun && lastSuccess && lastRun.id === lastSuccess.id);

  return {
    meta: {
      base_currency: config.baseCurrency,
      timezone: config.schedule.timezone,
      schedule_cron: config.schedule.cron,
      generated_at: new Date().toISOString(),
    },
    status: {
      system_status: systemStatus,           // green | yellow | red
      status_label: statusLabel,
      is_stale: isStale,
      last_successful_update: lastSuccess
        ? { iso: lastSuccess.execution_timestamp, human: lastSuccess.execution_timestamp_ist,
            type: lastSuccess.execution_type, source: lastSuccess.data_source,
            currencies_successful: lastSuccess.currencies_successful,
            currencies_failed: lastSuccess.currencies_failed,
            currencies_flagged: lastSuccess.currencies_flagged,
            requested: lastSuccess.currencies_requested }
        : null,
      last_run: lastRun
        ? { iso: lastRun.execution_timestamp, human: lastRun.execution_timestamp_ist,
            type: lastRun.execution_type, status: lastRun.status,
            error_message: lastRun.error_message }
        : null,
      next_scheduled_update: { iso: next.iso, human: next.human },
      server_now_ist: istHuman(),
    },
    providers: listProviders(),
    active_provider: config.provider.primary,
    visa_summary: (() => {
      const core = rows.filter((r) => !r.is_reference);
      const configured = core.filter((r) => r.price_configured);
      return {
        total_countries: core.length,
        configured: configured.length,
        not_configured: core.length - configured.length,
        total_inr_today: configured.reduce((s, r) => s + (r.inr_cost || 0), 0),
        needs_setup: configured.length === 0,
      };
    })(),
    currencies: rows,
  };
}
