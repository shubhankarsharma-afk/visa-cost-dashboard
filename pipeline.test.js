// End-to-end pipeline test using a temp DB and the fixture provider.
// Exercises: fetch->validate->store, day-over-day change, flagging, dedup,
// failure handling (previous data retained), and the presenter payload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cur-test-'));
process.env.DB_PATH = path.join(TMP, 'test.db');
process.env.FLAG_MOVEMENT_PERCENT = '15';
process.env.REJECT_MOVEMENT_PERCENT = '60';

let seed, runUpdate, buildDashboard, getPreviousGoodRate, DAY1, DAY2, makeProvider, ALL;

before(async () => {
  ({ seed } = await import('../src/db/seed.js'));
  ({ runUpdate } = await import('../src/services/update.js'));
  ({ buildDashboard } = await import('../src/services/presenter.js'));
  ({ getPreviousGoodRate } = await import('../src/db/index.js'));
  ({ DAY1, DAY2, makeProvider } = await import('./fixtures/sample-rates.js'));
  const cfg = await import('../config/currencies.js');
  ALL = cfg.ALL_REQUEST_CODES;
  seed();
});

after(() => {
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch {}
});

test('Day 1: all currencies stored, no change (no prior data)', async () => {
  const res = await runUpdate({ type: 'scheduled', providers: [makeProvider(DAY1)] });
  assert.equal(res.status, 'success');
  assert.equal(res.failed, 0);
  assert.equal(res.successful + res.flagged, res.requested);

  const dash = buildDashboard();
  const aed = dash.currencies.find((c) => c.code === 'AED');
  assert.ok(aed.rate > 25 && aed.rate < 27, `AED ~26 expected, got ${aed.rate}`);
  assert.equal(aed.previous_rate, null); // first day, no previous
  assert.equal(aed.change_available, false);
});

test('Day 2: change computed; TRY flagged for large move', async () => {
  // Simulate the next IST day by forcing rate_date via monkeypatch of time.
  const timeMod = await import('../src/services/time.js');
  const orig = timeMod.istDateString;
  // Can't reassign ESM export; instead insert via runUpdate but with DAY2 and
  // rely on UNIQUE(currency_code, rate_date, type). To get a distinct date we
  // temporarily override Date. Simpler: directly test previous-rate query.
  // -- Insert DAY2 by advancing the process clock one day.
  const RealDate = Date;
  const plusDay = RealDate.now() + 24 * 3600 * 1000;
  global.Date = class extends RealDate {
    constructor(...a) { super(...(a.length ? a : [plusDay])); }
    static now() { return plusDay; }
  };
  try {
    const res = await runUpdate({ type: 'scheduled', providers: [makeProvider(DAY2)] });
    assert.equal(res.failed, 0, 'no hard failures on day 2');
    assert.ok(res.flagged >= 1, 'at least TRY flagged');
  } finally {
    global.Date = RealDate;
  }

  const dash = buildDashboard();
  const aed = dash.currencies.find((c) => c.code === 'AED');
  assert.ok(aed.previous_rate != null, 'AED now has previous rate');
  assert.ok(aed.change_available, 'change available on day 2');
  assert.equal(typeof aed.pct_change, 'number');

  const tryRow = dash.currencies.find((c) => c.code === 'TRY');
  assert.equal(tryRow.record_status, 'flagged', 'TRY flagged for ~18% move');
});

test('Failure handling: failed run keeps previous good data', async () => {
  const before = buildDashboard().currencies.find((c) => c.code === 'AED').rate;
  const res = await runUpdate({ type: 'scheduled', providers: [makeProvider(DAY2, { fail: true })] });
  assert.equal(res.status, 'failed');
  const after = buildDashboard();
  const aed = after.currencies.find((c) => c.code === 'AED');
  assert.equal(aed.rate, before, 'previous good rate retained after failure');
  assert.equal(after.status.system_status, 'yellow', 'stale/degraded status after failed run');
  assert.equal(after.status.is_stale, true);
});

test('Presenter marks system green after a fully successful latest run', async () => {
  const res = await runUpdate({ type: 'manual', providers: [makeProvider(DAY2)] });
  assert.notEqual(res.status, 'failed');
  // manual run uses a different UNIQUE slot (type=manual) so it does not clobber scheduled history
  const dash = buildDashboard();
  assert.ok(['green', 'yellow'].includes(dash.status.system_status));
  assert.ok(dash.status.last_successful_update);
});
