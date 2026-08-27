-- ============================================================================
--  Schema for the Currency-to-INR Monitoring Dashboard
--  Engine: SQLite (via better-sqlite3). Portable to Postgres with minor edits
--  (see README "Swapping the database").
-- ============================================================================

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---- Master list of tracked currencies -------------------------------------
CREATE TABLE IF NOT EXISTS currencies (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  country       TEXT    NOT NULL,
  currency_name TEXT    NOT NULL,
  iso_code      TEXT    NOT NULL UNIQUE,          -- ISO 4217
  display_unit  INTEGER NOT NULL DEFAULT 1,       -- e.g. 1000 for VND
  decimals      INTEGER NOT NULL DEFAULT 4,       -- display precision
  is_card       INTEGER NOT NULL DEFAULT 0,       -- show as a top card
  is_reference  INTEGER NOT NULL DEFAULT 0,       -- benchmark (USD/EUR)
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- ---- Every recorded rate (append-only history — never overwritten) ----------
CREATE TABLE IF NOT EXISTS exchange_rates (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  currency_code     TEXT    NOT NULL,             -- foreign ISO code
  base_currency     TEXT    NOT NULL,             -- always INR here
  rate_date         TEXT    NOT NULL,             -- YYYY-MM-DD (IST business day)
  rate              REAL,                         -- INR per 1 foreign unit (full precision)
  previous_rate     REAL,                         -- prior recorded rate for this currency
  abs_change        REAL,                         -- rate - previous_rate
  pct_change        REAL,                         -- ((rate-prev)/prev)*100
  rate_timestamp    TEXT,                         -- provider's own timestamp (UTC ISO)
  fetched_timestamp TEXT    NOT NULL,             -- when WE fetched (UTC ISO)
  update_type       TEXT    NOT NULL DEFAULT 'scheduled', -- scheduled | manual
  data_source       TEXT    NOT NULL,             -- provider id, e.g. erapi/xe
  status            TEXT    NOT NULL DEFAULT 'success',    -- success | failed | flagged
  flagged_reason    TEXT,                         -- why flagged, if any
  UNIQUE (currency_code, rate_date, update_type)  -- dedup guard
);

CREATE INDEX IF NOT EXISTS idx_rates_code_date  ON exchange_rates (currency_code, rate_date);
CREATE INDEX IF NOT EXISTS idx_rates_date       ON exchange_rates (rate_date);
CREATE INDEX IF NOT EXISTS idx_rates_code       ON exchange_rates (currency_code);
CREATE INDEX IF NOT EXISTS idx_rates_fetched    ON exchange_rates (fetched_timestamp);
CREATE INDEX IF NOT EXISTS idx_rates_status     ON exchange_rates (status);

-- ---- One row per update run (scheduled or manual) --------------------------
CREATE TABLE IF NOT EXISTS update_logs (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  execution_timestamp   TEXT    NOT NULL,         -- UTC ISO
  execution_timestamp_ist TEXT  NOT NULL,         -- human IST string
  rate_date             TEXT    NOT NULL,         -- business day this run targeted
  execution_type        TEXT    NOT NULL,         -- scheduled | manual
  currencies_requested  INTEGER NOT NULL DEFAULT 0,
  currencies_successful INTEGER NOT NULL DEFAULT 0,
  currencies_failed     INTEGER NOT NULL DEFAULT 0,
  currencies_flagged    INTEGER NOT NULL DEFAULT 0,
  data_source           TEXT,
  status                TEXT    NOT NULL,          -- success | partial | failed
  error_message         TEXT,
  duration_ms           INTEGER
);

CREATE INDEX IF NOT EXISTS idx_logs_ts     ON update_logs (execution_timestamp);
CREATE INDEX IF NOT EXISTS idx_logs_status ON update_logs (status);
CREATE INDEX IF NOT EXISTS idx_logs_date   ON update_logs (rate_date);

-- ---- Visa prices (append-only, VERSIONED) ----------------------------------
-- Source of truth = visa price in FOREIGN currency. The INR cost is always
-- DERIVED (price x latest exchange rate) and is never stored here.
-- Each edit supersedes the prior active row and inserts a new active row, so
-- this single table is BOTH the current price (is_active=1) AND the full
-- history. Historical INR cost on date D = (version active on D) x (rate on D).
CREATE TABLE IF NOT EXISTS visa_prices (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  country             TEXT    NOT NULL,
  currency_code       TEXT    NOT NULL,
  visa_price          REAL    NOT NULL,        -- in foreign currency (full precision)
  effective_from      TEXT    NOT NULL,        -- ISO timestamp (UTC) the version began
  effective_from_date TEXT    NOT NULL,        -- YYYY-MM-DD (IST) for date comparisons
  effective_until     TEXT,                    -- ISO timestamp; NULL = current
  effective_until_date TEXT,                   -- YYYY-MM-DD; NULL = current
  is_active           INTEGER NOT NULL DEFAULT 1,   -- 1 = current active version
  status              TEXT    NOT NULL DEFAULT 'active', -- active | superseded
  changed_by          TEXT    NOT NULL DEFAULT 'user',
  changed_at          TEXT    NOT NULL,         -- ISO timestamp of the change
  changed_at_ist      TEXT    NOT NULL          -- human IST string
);

CREATE INDEX IF NOT EXISTS idx_visa_code        ON visa_prices (currency_code);
CREATE INDEX IF NOT EXISTS idx_visa_active      ON visa_prices (currency_code, is_active);
CREATE INDEX IF NOT EXISTS idx_visa_eff_from    ON visa_prices (currency_code, effective_from_date);
CREATE UNIQUE INDEX IF NOT EXISTS idx_visa_one_active
  ON visa_prices (currency_code) WHERE is_active = 1;
