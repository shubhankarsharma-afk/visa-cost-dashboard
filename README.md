# Global Visa Cost Dashboard (Currency → INR)

A production-ready, **automatically-updating** dashboard that answers one
question instantly: **how much will each country's visa cost me in Indian
Rupees today?** It combines two clearly-separated layers:

1. **Exchange rate** (automatic) — the INR value of 14 foreign currencies
   (plus USD/EUR reference) is fetched every day at 09:00 IST.
2. **Visa price** (user-maintained) — you set each country's visa price once,
   in its own currency. The **INR visa cost is derived** = `visa price × latest
   exchange rate`, and updates itself daily without you touching the price.

- **Visa price is the source of truth**, stored persistently and **versioned**
  (full price history). It changes ONLY when you explicitly edit and save it —
  never because an exchange rate moved.
- **INR visa cost is always derived**, never stored as the source of truth, so
  it recalculates the moment either the rate or the price changes.
- **Automatic daily exchange-rate update at 09:00 AM IST** (`Asia/Kolkata`) via
  a scheduled backend job — runs whether or not anyone opens the dashboard.
- **Append-only historical database** (SQLite) — exchange rates and visa-price
  versions are never overwritten; historical INR visa cost on any past date =
  `price active that date × rate that date`.
- **Swappable data-provider layer** — keyless real-data default, with adapters
  for XE Currency Data API and other keyed providers.
- **Robust failure handling** — a failed fetch keeps the last successful rates
  AND the visa prices, flags the dashboard as stale, logs it, and retries.
- Clean, responsive UI: visa-cost cards & table, Edit Price modal, first-run
  "Configure Visa Prices" setup, price history, trend charts (visa cost or
  rate), live status panel, **Refresh Exchange Rates**, search/filter/sort.

> **Two separate actions, never mixed:** *Refresh Exchange Rates* (API/auto)
> and *Edit Visa Prices* (user). Refreshing rates never changes a visa price;
> editing a price never triggers a rate fetch.

---

## Table of contents

1. [Architecture](#architecture)
2. [Quick start](#quick-start)
3. [Configuration (.env)](#configuration-env)
4. [Where do I put my API key?](#where-do-i-put-my-api-key)
5. [The daily 09:00 IST scheduler](#the-daily-0900-ist-scheduler)
6. [Database schema](#database-schema)
7. [REST API](#rest-api)
8. [Deployment](#deployment)
9. [How-to: change currencies / time / provider](#how-to)
10. [Testing](#testing)
11. [Security notes](#security-notes)
12. [A note on the data source you chose (XE)](#a-note-on-xe)

---

## Architecture

```
                          ┌─────────────────────────────────────────┐
   09:00 IST daily ─────► │  Scheduler (node-cron, IST-aware)        │
   OS cron / GH Actions ─►│  + scripts/run-update.js (standalone)    │
                          └───────────────────┬─────────────────────┘
                                              ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Update service:  fetch → validate → compute change → store │
        │  Provider chain:  primary → fallback  (swappable adapters)  │
        └───────────────────┬───────────────────────┬────────────────┘
                            ▼                        ▼
                 ┌────────────────────┐   ┌────────────────────────┐
                 │  Provider adapters │   │  SQLite (append-only)  │
                 │  erapi / xe / …    │   │  currencies            │
                 └────────────────────┘   │  exchange_rates (hist) │
                                          │  update_logs           │
                                          └───────────┬────────────┘
                                                      ▼
        ┌────────────────────────────────────────────────────────────┐
        │  Express API  (/api/dashboard, /api/history, /api/refresh)  │
        │  + static responsive frontend (cards, table, charts)        │
        └────────────────────────────────────────────────────────────┘
```

**Stack:** Node.js (ESM) · Express · better-sqlite3 · node-cron · Chart.js
(vendored locally, no CDN dependency). No build step; no framework lock-in.

### Folder structure

```
currency-inr-dashboard/
├── config/
│   └── currencies.js          # SINGLE source of truth for tracked currencies
├── src/
│   ├── config.js              # env-driven runtime config
│   ├── index.js               # Express app + scheduler bootstrap
│   ├── logger.js
│   ├── scheduler.js           # in-process node-cron (09:00 IST)
│   ├── db/
│   │   ├── schema.sql         # tables + indexes
│   │   ├── index.js           # the ONLY SQL layer (swap here for Postgres)
│   │   ├── migrate.js         # create tables
│   │   └── seed.js            # load currencies from config
│   ├── providers/
│   │   ├── index.js           # provider registry + primary/fallback chain
│   │   ├── http.js            # fetch w/ timeout + retry + key redaction
│   │   ├── erapi.js           # open.er-api.com  (KEYLESS default)
│   │   ├── xe.js              # XE Currency Data API (paid key)
│   │   ├── exchangerate-api.js# ExchangeRate-API v6 (keyed, historical)
│   │   └── exchangeratehost.js# exchangerate.host (keyed)
│   ├── services/
│   │   ├── update.js          # core job: fetch/validate/store/compare/log
│   │   ├── validate.js        # null/negative/extreme/code-match checks
│   │   ├── presenter.js       # builds the dashboard JSON payloads
│   │   └── time.js            # IST date + next-run computation
│   └── routes/
│       └── api.js             # REST endpoints (+ manual-refresh rate limit)
├── scripts/
│   ├── run-update.js          # standalone job entry (OS cron / CI)
│   └── seed-sample-data.js    # DEV-ONLY offline demo data
├── public/                    # frontend (index.html, styles.css, app.js, vendor/)
├── tests/                     # node --test suite + fixtures
├── .github/workflows/daily-update.yml
├── Dockerfile
├── .env.example
└── README.md
```

---

## Quick start

```bash
# 1. Install
npm install

# 2. Configure (copy the template; defaults work with NO API key)
cp .env.example .env

# 3. Create the database + load the currency list
npm run migrate
npm run seed

# 4. (optional) Preview immediately with a captured 2-day sample
npm run demo          # DEV-ONLY demo data — skip for real data

# 5a. Fetch REAL live rates once (needs outbound internet):
npm run update

# 5b. Start the server (also starts the 09:00 IST in-process scheduler)
npm start
#    → open http://localhost:3000
```

> The default provider (`erapi` = open.er-api.com) is **keyless and returns real
> live rates**, so the dashboard works the moment you run `npm run update`,
> without any signup. Historical trend data accumulates from each daily run;
> for instant backfilled history use a keyed provider (see below).

---

## Configuration (.env)

Every setting lives in `.env` (never commit it). See `.env.example` for the
full annotated list. The most important ones:

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `BASE_CURRENCY` | `INR` | Base currency (the app is designed around INR) |
| `SCHEDULE_CRON` | `0 9 * * *` | Daily run time (minute hour * * *) |
| `SCHEDULE_TIMEZONE` | `Asia/Kolkata` | Timezone the cron is evaluated in |
| `ENABLE_INPROCESS_SCHEDULER` | `true` | Toggle the built-in node-cron job |
| `PROVIDER` | `erapi` | Primary data provider |
| `FALLBACK_PROVIDER` | `erapi` | Used if the primary fails/unconfigured |
| `FLAG_MOVEMENT_PERCENT` | `15` | Day-over-day move ≥ this is **flagged** |
| `REJECT_MOVEMENT_PERCENT` | `60` | Move ≥ this is treated as bad data |
| `MANUAL_REFRESH_MIN_INTERVAL_SECONDS` | `60` | Server-side manual-refresh throttle |
| `REFERENCE_CURRENCIES` | `USD,EUR` | Benchmark currencies to show |

---

## Where do I put my API key?

**You do not need any key to run the app** (the default provider is keyless).
If you want to use a keyed provider, paste the credentials into **`.env`**
(never into frontend code). The relevant lines in `.env`:

```dotenv
# --- XE Currency Data API (your chosen source) ---
XE_ACCOUNT_ID=paste-your-xe-account-id-here
XE_API_KEY=paste-your-xe-api-key-here

# then switch the provider:
PROVIDER=xe
FALLBACK_PROVIDER=erapi     # keyless safety net if XE is unreachable
```

Other keyed options (same idea):

```dotenv
EXCHANGERATE_API_KEY=...      # then PROVIDER=exchangerate-api
EXCHANGERATEHOST_API_KEY=...  # then PROVIDER=exchangeratehost
```

Keys are read **only on the server**, are **never** sent to the browser, and are
**redacted from logs**. The frontend only ever calls this app's own `/api/*`.

---

## The daily 09:00 IST scheduler

The update is designed to run **independently of the dashboard being open**.
There are two layers; for production, use **both**:

### 1. In-process scheduler (built in)

`src/scheduler.js` uses `node-cron` with `timezone: Asia/Kolkata`. It starts
automatically with `npm start` and fires `SCHEDULE_CRON` (default `0 9 * * *`).
On boot it logs the next run time.

### 2. OS-level backup (recommended for reliability)

So updates still happen if the web process restarts around 09:00, add an OS cron
entry on the host that runs the **standalone** job. `crontab -e`:

```cron
# 09:00 IST daily. If the server's system clock is UTC, use 03:30 UTC instead
# (09:00 IST = 03:30 UTC) and drop CRON_TZ.
CRON_TZ=Asia/Kolkata
0 9 * * *  cd /path/to/currency-inr-dashboard && /usr/bin/node scripts/run-update.js >> data/cron.log 2>&1
```

If you prefer not to run the in-process one, set
`ENABLE_INPROCESS_SCHEDULER=false` and rely on OS cron / GitHub Actions only.

### 3. GitHub Actions (cloud backup)

`.github/workflows/daily-update.yml` runs at `30 3 * * *` UTC (= 09:00 IST) and,
by default, calls your deployed app's `/api/refresh`. Set the `APP_URL`
repository secret. (A commented “run job in CI” mode is included for when you
move to a shared/remote database.)

### What one run does

1. Resolve the IST business date. 2. Fetch all currencies from the provider
chain. 3. Validate each rate (present, positive, code-matches, movement sane).
4. Look up the previous good rate and compute **absolute** and **% change**.
5. Store an append-only row per currency. 6. Write an `update_logs` row with
success/partial/failed counts. 7. On total failure, **keep** the last good data
and mark the system stale.

---

## Database schema

SQLite (file at `data/currency.db`). Full DDL in `src/db/schema.sql`.

**`currencies`** — master list (id, country, currency_name, iso_code,
display_unit, decimals, is_card, is_reference, active).

**`exchange_rates`** — append-only history. Columns: `currency_code`,
`base_currency`, `rate_date`, `rate` (INR per 1 foreign unit, full precision),
`previous_rate`, `abs_change`, `pct_change`, `rate_timestamp` (provider),
`fetched_timestamp` (ours), `update_type` (`scheduled`|`manual`), `data_source`,
`status` (`success`|`flagged`|`failed`), `flagged_reason`.
`UNIQUE(currency_code, rate_date, update_type)` prevents duplicate records for
the same currency/day/type. Indexed on date, code, timestamp, status.

**`update_logs`** — one row per run: timestamps (UTC + IST), `execution_type`,
requested/successful/failed/flagged counts, `data_source`, `status`,
`error_message`, `duration_ms`.

**`visa_prices`** — the visa price (foreign currency) per country, **append-only
and versioned**: each edit supersedes the prior active row (`is_active=0`,
`status='superseded'`, `effective_until*` set) and inserts a new active row.
This one table is BOTH the current price (`is_active=1`) and the full history.
Columns: `country`, `currency_code`, `visa_price` (foreign, full precision),
`effective_from`/`effective_from_date`, `effective_until`/`effective_until_date`,
`is_active`, `status`, `changed_by`, `changed_at`/`changed_at_ist`. Indexed on
code, active flag, and effective date; a partial unique index guarantees exactly
one active version per currency. **The derived INR visa cost is never stored
here** — it is computed as `visa_price × exchange rate` on read.

> **Visa business rule (exact):** if a price exists, use the latest active saved
> price indefinitely; if the user changes it, use the new price from its
> effective date onward; if the exchange rate changes, keep the price and only
> recalculate the INR amount; on dashboard open, load the active price + latest
> successful rate and compute the INR cost. A country with no price shows
> **"Not Configured"** — never ₹0.

> **Direction of conversion:** `rate` is always **INR per 1 unit of the foreign
> currency** (e.g. `AED.rate = 26.11` ⇒ 1 AED = ₹26.11). For low-value
> currencies the UI also shows a readable multiple (e.g. 1,000 VND = ₹3.64).

---

## REST API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Full snapshot: currencies, cards, status |
| `GET` | `/api/status` | System status + providers only |
| `GET` | `/api/history/:code?days=7\|30\|90\|365` | Historical series for a currency |
| `GET` | `/api/logs?limit=N` | Recent update runs (audit) |
| `POST`| `/api/refresh` | Manual **exchange-rate** update (rate-limited, `update_type=manual`) — never changes visa prices |
| `GET` | `/api/visa-history/:code?days=` | Historical **INR visa-cost** series (price-on-date × rate-on-date) |
| `POST`| `/api/visa-prices/:code` | Save/replace one visa price (new version); body `{ "price": 100 }` |
| `POST`| `/api/visa-prices` | Bulk save (first-run setup); body `{ "prices": { "AED": 100, ... } }` |
| `GET` | `/api/visa-prices/:code/history` | Visa-price version history (with INR-at-change) |
| `GET` | `/healthz` | Liveness probe |

All values come from the **last successfully stored** data. The frontend never
invents a “last updated” time — it always reflects the real update timestamp.

---

## Deployment

### Node host (Render / Railway / Fly / VPS)

```bash
npm install --omit=dev
npm run migrate && npm run seed
# set env vars (PORT, PROVIDER, keys…) in the platform dashboard
npm start
```

Add the [OS cron backup](#the-daily-0900-ist-scheduler) (or the GitHub Actions
workflow) and mount a persistent disk for `data/` so history survives restarts.

### Docker

```bash
docker build -t currency-inr .
docker run -d --name currency-inr \
  -p 3000:3000 \
  -v $(pwd)/data:/app/data \
  --env-file .env \
  currency-inr
```

The container seeds the DB, starts the server, and runs the in-process
scheduler. The `data/` volume persists the SQLite history.

---

## How-to

### Add or remove a currency

Edit **`config/currencies.js`** — add/remove an object (use the correct ISO 4217
code; set `card: true` to show a top card, `display_unit` for readable multiples
of low-value currencies). Then:

```bash
npm run seed     # idempotent; updates the currencies table
npm run update   # optional: fetch the new currency immediately
```

Nothing else needs to change — the provider request list, table, cards, filters
and charts all derive from this file.

### Set and manage visa prices

On first open, click **Configure Visa Prices** (or the setup banner) and enter
each country's visa price in its own currency — once. To change one later, click
**Edit Price** on any card or table row; the INR cost recalculates immediately at
the current rate, and the previous price is preserved in **Visa Price History**.
Prices are stored server-side (SQLite), so they persist across restarts and are
never altered by the daily exchange-rate job. Countries you leave blank show
**"Not Configured"** and are excluded from totals (never counted as ₹0).

### Change the scheduled update time

Edit `.env`:

```dotenv
SCHEDULE_CRON=30 8 * * *     # e.g. 08:30 instead of 09:00
SCHEDULE_TIMEZONE=Asia/Kolkata
```

Restart the app. If you use the OS-cron backup, update that crontab line too
(remember GitHub Actions cron is in **UTC**).

### Change the API provider

Edit `.env`:

```dotenv
PROVIDER=xe                 # erapi | xe | exchangerate-api | exchangeratehost
FALLBACK_PROVIDER=erapi
XE_ACCOUNT_ID=...
XE_API_KEY=...
```

To add a **brand-new** provider, create `src/providers/<name>.js` exporting
`{ id, label, supportsHistorical, isConfigured, fetchLatest, fetchHistorical }`
(each `fetchLatest` must return `rate = INR per 1 foreign unit`), then register
it in `src/providers/index.js`. That is the only code change required.

### Swap SQLite for Postgres

`src/db/index.js` is the only module that runs SQL. Re-implement its exported
functions against `pg` (or Supabase), keep the same signatures, and the rest of
the app is unchanged. `schema.sql` translates directly (use `SERIAL`/`BIGSERIAL`
and `TIMESTAMPTZ`).

---

## Testing

```bash
npm test          # runs the offline test suite (node --test)
```

Covered (offline, no network needed — uses a captured real sample fixture):

- **Validation:** null, negative, code-mismatch, flag threshold, reject
  threshold, no-previous-rate.
- **Pipeline:** day-1 store, day-2 day-over-day change, TRY flagged for a large
  move, dedup (scheduled vs manual slots).
- **Failure handling:** a failed run keeps the previous good data and marks the
  system stale.
- **Presenter:** system status transitions (green/yellow) and last-successful
  tracking.
- **Visa layer:** price validation (commas accepted), "Not Configured" ≠ ₹0,
  the exact **Day 1–5 scenario** (price stays fixed while the rate moves; INR
  cost recalculates; editing creates a new version; history preserved;
  historical price-on-date lookup), and API failure not erasing visa prices.

Failure scenarios you can exercise manually: unplug the network and run
`npm run update` (→ logged failure, old data retained); set an invalid
`XE_API_KEY` with `PROVIDER=xe` (→ falls back to `erapi`).

---

## Security notes

- API keys live in `.env` (server-side), never in frontend JS; they are redacted
  from logs and never returned by the API.
- `helmet` sets a strict Content-Security-Policy (`script-src 'self'`; Chart.js
  is vendored locally, no third-party CDN).
- Manual refresh is rate-limited server-side; users cannot write or edit stored
  rates from the frontend (no such endpoints exist).
- Inputs to `/api/history/:code` are validated against a strict pattern.
- Run behind HTTPS in production; if you expose `/api/refresh` publicly, put it
  behind a reverse-proxy auth or add a shared-secret check.

---

## A note on XE

You selected **xe.com** as the data source. XE does not offer a free or public
API, and scraping xe.com is prohibited by their terms — so this project uses
their official **XE Currency Data API** (a paid product; you receive an *Account
ID* + *API Key*). The adapter is at `src/providers/xe.js`; paste your XE
credentials into `.env` and set `PROVIDER=xe` to activate it.

Because XE billing may take time to set up, the app **defaults to a keyless
provider (`open.er-api.com`) that returns real live rates immediately**, and is
kept as the automatic fallback even after you enable XE — so the dashboard is
never empty and never shows fabricated data. Switching between them is a single
line in `.env`.
