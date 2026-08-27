import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateRate, validateProviderTimestamp } from '../src/services/validate.js';

test('accepts a normal rate', () => {
  const v = validateRate({ code: 'AED', requestedCode: 'AED', rate: 26.06, previousRate: 26.0 });
  assert.equal(v.ok, true);
  assert.equal(v.status, 'success');
});

test('rejects null rate', () => {
  const v = validateRate({ code: 'AED', requestedCode: 'AED', rate: null, previousRate: 26 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 'failed');
});

test('rejects negative rate', () => {
  const v = validateRate({ code: 'AED', requestedCode: 'AED', rate: -1, previousRate: 26 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 'failed');
});

test('rejects code mismatch', () => {
  const v = validateRate({ code: 'MAD', requestedCode: 'AED', rate: 26, previousRate: 26 });
  assert.equal(v.ok, false);
  assert.match(v.reason, /mismatch/i);
});

test('flags large-but-plausible move (kept)', () => {
  // +18% move -> between flag(15) and reject(60)
  const v = validateRate({ code: 'TRY', requestedCode: 'TRY', rate: 2.36, previousRate: 2.0 });
  assert.equal(v.ok, true);
  assert.equal(v.status, 'flagged');
});

test('rejects implausible move (>=60%)', () => {
  const v = validateRate({ code: 'TRY', requestedCode: 'TRY', rate: 5.0, previousRate: 2.0 });
  assert.equal(v.ok, false);
  assert.equal(v.status, 'failed');
});

test('accepts when no previous rate exists', () => {
  const v = validateRate({ code: 'AED', requestedCode: 'AED', rate: 26.06, previousRate: null });
  assert.equal(v.ok, true);
  assert.equal(v.status, 'success');
});

test('timestamp validation flags stale provider data', () => {
  const old = new Date(Date.now() - 100 * 3600 * 1000).toISOString();
  const r = validateProviderTimestamp(old);
  assert.equal(r.ok, true);
  assert.match(r.warn, /old/);
});
