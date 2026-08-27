// Database access layer. Wraps better-sqlite3 and exposes typed repository
// functions. This is the ONLY module that talks SQL, so swapping to Postgres
// later means re-implementing just this file (see README).
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';

let db;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });
  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  return db;
}

// ---- Currency master --------------------------------------------------------
export function upsertCurrency(c) {
  getDb()
    .prepare(
      `INSERT INTO currencies
         (country, currency_name, iso_code, display_unit, decimals, is_card, is_reference, active)
       VALUES (@country, @currency_name, @iso_code, @display_unit, @decimals, @is_card, @is_reference, @active)
       ON CONFLICT(iso_code) DO UPDATE SET
         country=excluded.country,
         currency_name=excluded.currency_name,
         display_unit=excluded.display_unit,
         decimals=excluded.decimals,
         is_card=excluded.is_card,
         is_reference=excluded.is_reference,
         active=excluded.active`
    )
    .run(c);
}

export function getActiveCurrencies() {
  return getDb()
    .prepare('SELECT * FROM currencies WHERE active = 1 ORDER BY is_reference ASC, country ASC')
    .all();
}

export function getCurrencyByCode(code) {
  return getDb().prepare('SELECT * FROM currencies WHERE iso_code = ?').get(code);
}

// ---- Rates ------------------------------------------------------------------

// Most recent successful/flagged record for one currency (excludes 'failed').
export function getLatestGoodRate(code) {
  return getDb()
    .prepare(
      `SELECT * FROM exchange_rates
        WHERE currency_code = ? AND status IN ('success','flagged')
        ORDER BY rate_date DESC, id DESC LIMIT 1`
    )
    .get(code);
}

// Latest good record for every currency (one row each).
export function getLatestRatesAll() {
  return getDb()
    .prepare(
      `SELECT er.* FROM exchange_rates er
        JOIN (
          SELECT currency_code, MAX(id) AS max_id
            FROM exchange_rates
           WHERE status IN ('success','flagged')
           GROUP BY currency_code
        ) latest ON er.id = latest.max_id`
    )
    .all();
}

export function insertRate(r) {
  return getDb()
    .prepare(
      `INSERT INTO exchange_rates
        (currency_code, base_currency, rate_date, rate, previous_rate, abs_change, pct_change,
         rate_timestamp, fetched_timestamp, update_type, data_source, status, flagged_reason)
       VALUES
        (@currency_code, @base_currency, @rate_date, @rate, @previous_rate, @abs_change, @pct_change,
         @rate_timestamp, @fetched_timestamp, @update_type, @data_source, @status, @flagged_reason)
       ON CONFLICT(currency_code, rate_date, update_type) DO UPDATE SET
         rate=excluded.rate,
         previous_rate=excluded.previous_rate,
         abs_change=excluded.abs_change,
         pct_change=excluded.pct_change,
         rate_timestamp=excluded.rate_timestamp,
         fetched_timestamp=excluded.fetched_timestamp,
         data_source=excluded.data_source,
         status=excluded.status,
         flagged_reason=excluded.flagged_reason`
    )
    .run(r);
}

// Latest good rate for a currency STRICTLY BEFORE a given date — this is the
// "previous rate" used for day-over-day change (avoids comparing today to itself).
export function getPreviousGoodRate(code, beforeDate) {
  return getDb()
    .prepare(
      `SELECT * FROM exchange_rates
        WHERE currency_code = ? AND status IN ('success','flagged') AND rate_date < ?
        ORDER BY rate_date DESC, id DESC LIMIT 1`
    )
    .get(code, beforeDate);
}

// Good rate for a currency ON a specific date, else the latest good one before it.
export function getRateForDate(code, date) {
  return getDb()
    .prepare(
      `SELECT * FROM exchange_rates
        WHERE currency_code = ? AND status IN ('success','flagged') AND rate_date <= ?
        ORDER BY rate_date DESC, id DESC LIMIT 1`
    )
    .get(code, date);
}

// History for one currency within N days (for charts). Successful/flagged only.
export function getHistory(code, sinceDate) {
  return getDb()
    .prepare(
      `SELECT rate_date, rate, abs_change, pct_change, data_source, status, rate_timestamp
         FROM exchange_rates
        WHERE currency_code = ? AND status IN ('success','flagged') AND rate_date >= ?
        ORDER BY rate_date ASC, id ASC`
    )
    .all(code, sinceDate);
}

// ---- Visa prices (versioned) ------------------------------------------------

// Current active visa price for a currency (or undefined).
export function getActiveVisaPrice(code) {
  return getDb()
    .prepare('SELECT * FROM visa_prices WHERE currency_code = ? AND is_active = 1 LIMIT 1')
    .get(code);
}

// All active visa prices (one row per configured currency).
export function getAllActiveVisaPrices() {
  return getDb().prepare('SELECT * FROM visa_prices WHERE is_active = 1').all();
}

// Full version history for a currency (newest first).
export function getVisaPriceHistory(code) {
  return getDb()
    .prepare('SELECT * FROM visa_prices WHERE currency_code = ? ORDER BY id DESC')
    .all(code);
}

// The visa-price version that was active on a given date (YYYY-MM-DD).
export function getVisaPriceOnDate(code, date) {
  return getDb()
    .prepare(
      `SELECT * FROM visa_prices
        WHERE currency_code = ?
          AND effective_from_date <= ?
          AND (effective_until_date IS NULL OR effective_until_date > ?)
        ORDER BY id DESC LIMIT 1`
    )
    .get(code, date, date);
}

// Set/replace the active visa price (supersede previous + insert new), atomically.
// Returns the new active row.
export function setVisaPrice({ country, currency_code, visa_price, changed_by = 'user', nowIso, todayDate, nowIst }) {
  const db = getDb();
  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE visa_prices
          SET is_active = 0, status = 'superseded',
              effective_until = @nowIso, effective_until_date = @todayDate
        WHERE currency_code = @currency_code AND is_active = 1`
    ).run({ currency_code, nowIso, todayDate });

    db.prepare(
      `INSERT INTO visa_prices
        (country, currency_code, visa_price, effective_from, effective_from_date,
         effective_until, effective_until_date, is_active, status, changed_by, changed_at, changed_at_ist)
       VALUES
        (@country, @currency_code, @visa_price, @nowIso, @todayDate,
         NULL, NULL, 1, 'active', @changed_by, @nowIso, @nowIst)`
    ).run({ country, currency_code, visa_price, nowIso, todayDate, changed_by, nowIst });
  });
  tx();
  return getActiveVisaPrice(currency_code);
}

// ---- Update logs ------------------------------------------------------------
export function insertUpdateLog(log) {
  return getDb()
    .prepare(
      `INSERT INTO update_logs
        (execution_timestamp, execution_timestamp_ist, rate_date, execution_type,
         currencies_requested, currencies_successful, currencies_failed, currencies_flagged,
         data_source, status, error_message, duration_ms)
       VALUES
        (@execution_timestamp, @execution_timestamp_ist, @rate_date, @execution_type,
         @currencies_requested, @currencies_successful, @currencies_failed, @currencies_flagged,
         @data_source, @status, @error_message, @duration_ms)`
    )
    .run(log);
}

// Latest run overall, and latest SUCCESSFUL (or partial) run.
export function getLastRun() {
  return getDb().prepare('SELECT * FROM update_logs ORDER BY id DESC LIMIT 1').get();
}
export function getLastSuccessfulRun() {
  return getDb()
    .prepare(
      `SELECT * FROM update_logs
        WHERE status IN ('success','partial')
        ORDER BY id DESC LIMIT 1`
    )
    .get();
}
export function getRecentRuns(limit = 20) {
  return getDb().prepare('SELECT * FROM update_logs ORDER BY id DESC LIMIT ?').all(limit);
}
