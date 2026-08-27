// Data validation. Runs on every fetched rate BEFORE it is trusted.
// Philosophy: reject clearly-bad data (null/negative/absurd), FLAG large-but-
// plausible market moves for human review (do not silently drop legit moves).
import { config } from '../config.js';

// Validate a single fetched value against its previous good rate.
// Returns { ok, status, reason } where status is 'success' | 'flagged' | 'failed'.
export function validateRate({ code, requestedCode, rate, previousRate, providerTimestamp }) {
  // 1. Currency code must match what we asked for.
  if (code !== requestedCode) {
    return { ok: false, status: 'failed', reason: `Code mismatch: got ${code}, expected ${requestedCode}` };
  }
  // 2. Must be present.
  if (rate === undefined || rate === null || Number.isNaN(rate)) {
    return { ok: false, status: 'failed', reason: 'Missing/null rate in API response' };
  }
  // 3. Must be a finite number.
  if (!Number.isFinite(rate)) {
    return { ok: false, status: 'failed', reason: 'Non-finite rate' };
  }
  // 4. Must be positive.
  if (rate <= 0) {
    return { ok: false, status: 'failed', reason: `Non-positive rate (${rate})` };
  }

  // 5. Movement checks vs previous good value (if we have one).
  if (previousRate != null && previousRate > 0) {
    const pct = Math.abs(((rate - previousRate) / previousRate) * 100);
    if (pct >= config.validation.rejectMovementPercent) {
      return {
        ok: false,
        status: 'failed',
        reason: `Implausible move ${pct.toFixed(2)}% (>= reject threshold ${config.validation.rejectMovementPercent}%) — value not trusted`,
      };
    }
    if (pct >= config.validation.flagMovementPercent) {
      return {
        ok: true,
        status: 'flagged',
        reason: `Significant movement detected: ${pct.toFixed(2)}% vs previous — kept but flagged for review`,
      };
    }
  }

  return { ok: true, status: 'success', reason: null };
}

// Validate the provider's overall timestamp — warn if suspiciously old.
export function validateProviderTimestamp(iso) {
  if (!iso) return { ok: true, warn: 'Provider returned no timestamp' };
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return { ok: false, warn: `Unparseable provider timestamp: ${iso}` };
  const ageHours = (Date.now() - t) / 3600000;
  if (ageHours > 48) return { ok: true, warn: `Provider data is ${ageHours.toFixed(0)}h old` };
  return { ok: true, warn: null };
}
