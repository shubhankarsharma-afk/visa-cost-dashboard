// Shared HTTP helper: timeout + retry with backoff. Uses global fetch (Node 18+).
import { config } from '../config.js';
import { logger } from '../logger.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchJson(url, { headers = {}, timeoutMs, retries, retryDelayMs } = {}) {
  timeoutMs = timeoutMs ?? config.provider.timeoutMs;
  retries = retries ?? config.provider.retries;
  retryDelayMs = retryDelayMs ?? config.provider.retryDelayMs;

  let lastErr;
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { headers, signal: controller.signal });
      clearTimeout(timer);
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 200)}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON from ${url}: ${text.slice(0, 200)}`);
      }
    } catch (err) {
      clearTimeout(timer);
      lastErr = err;
      const isLast = attempt === retries;
      logger.warn(`Fetch attempt ${attempt}/${retries} failed for ${redact(url)}: ${err.message}`);
      if (!isLast) await sleep(retryDelayMs * attempt);
    }
  }
  throw lastErr;
}

// Keep API keys out of logs.
export function redact(url) {
  return String(url).replace(/(api[_-]?key|apikey|access_key|token)=[^&]+/gi, '$1=***');
}
