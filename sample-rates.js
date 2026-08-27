// ============================================================================
//  OFFLINE TEST FIXTURE — NOT used by the running application.
//
//  These are REAL rates captured from open.er-api.com (base = INR) on
//  18-Aug-2026, used only to exercise the pipeline in tests / offline demo
//  where the live API is unreachable. The production app always fetches live
//  data from the configured provider. Values are "foreign units per 1 INR"
//  (the raw provider shape); the adapter inverts them to INR-per-unit.
// ============================================================================

// rates[X] = units of X per 1 INR (as returned by open.er-api.com/latest/INR)
export const DAY1 = {
  date: '2026-08-18',
  perInr: {
    VND: 273.083411, BHD: 0.003929, AED: 0.038377, TZS: 27.743731,
    KGS: 0.914866, AMD: 3.823919, ILS: 0.030959, MAD: 0.097077,
    TRY: 0.50107, IDR: 186.361909, GEL: 0.027318, KHR: 42.25,
    EGP: 0.525084, RUB: 0.889783, USD: 0.01045, EUR: 0.009026,
  },
};

// A synthetic "next day" with small realistic drift, to test change calc,
// gainers/losers, and one FLAGGED large-but-plausible move (TRY jumps ~18%).
export const DAY2 = {
  date: '2026-08-19',
  perInr: {
    VND: 274.5, BHD: 0.003921, AED: 0.038300, TZS: 27.60,
    KGS: 0.918, AMD: 3.80, ILS: 0.030800, MAD: 0.09690,
    TRY: 0.4250, IDR: 186.90, GEL: 0.027400, KHR: 42.10,
    EGP: 0.52600, RUB: 0.8950, USD: 0.010430, EUR: 0.009010,
  },
};

// Build a provider-style "fetchLatest" result (INR per 1 foreign unit).
export function toFetchResult(day, codes, sourceId = 'test-fixture') {
  const rates = {};
  for (const code of codes) {
    const perBase = day.perInr[code];
    if (perBase == null) continue;
    rates[code] = perBase === 0 ? null : 1 / perBase;
  }
  return { source: sourceId, base: 'INR', providerTimestamp: `${day.date}T00:02:31.000Z`, rates };
}

// A fake provider object usable as runUpdate({ providers: [makeProvider(day)] }).
export function makeProvider(day, { fail = false } = {}) {
  return {
    id: 'test-fixture',
    label: 'Test fixture',
    supportsHistorical: false,
    isConfigured: () => true,
    async fetchLatest(base, codes) {
      if (fail) throw new Error('Simulated provider failure');
      return toFetchResult(day, codes);
    },
    async fetchHistorical() {
      throw new Error('not supported');
    },
  };
}
