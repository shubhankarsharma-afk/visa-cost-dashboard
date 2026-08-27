// Timezone-aware helpers. The app's "business day" and scheduling are all
// anchored to the configured timezone (Asia/Kolkata by default), NOT the
// server's local time or the browser's clock.
import { config } from '../config.js';

const TZ = config.schedule.timezone;

// Current date string (YYYY-MM-DD) in the schedule timezone (IST).
export function istDateString(d = new Date()) {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
}

// Human-friendly IST timestamp, e.g. "19-Aug-2026 09:00 AM IST".
export function istHuman(d = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  }).formatToParts(d);
  const g = (t) => parts.find((p) => p.type === t)?.value || '';
  return `${g('day')}-${g('month')}-${g('year')} ${g('hour')}:${g('minute')} ${g('dayPeriod')} IST`;
}

// Offset (minutes) of the schedule timezone at instant d, relative to UTC.
function tzOffsetMinutes(d, timeZone) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(d).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour === '24' ? 0 : p.hour, p.minute, p.second);
  return (asUTC - d.getTime()) / 60000;
}

// Compute the next scheduled run for a DAILY cron "m h * * *" in the schedule
// timezone. Returns { iso, human }. Falls back to +24h for non-daily crons.
export function nextScheduledRun(from = new Date()) {
  const [min, hour, dom, mon, dow] = config.schedule.cron.trim().split(/\s+/);
  const isDaily = dom === '*' && mon === '*' && dow === '*' && /^\d+$/.test(min) && /^\d+$/.test(hour);
  if (!isDaily) {
    const next = new Date(from.getTime() + 24 * 3600 * 1000);
    return { iso: next.toISOString(), human: istHuman(next) };
  }
  const targetMin = Number(min);
  const targetHour = Number(hour);

  // Work in IST calendar terms.
  const istNow = istDateString(from); // YYYY-MM-DD
  const [Y, M, D] = istNow.split('-').map(Number);

  // Build a UTC instant for today's target time in IST, then adjust if passed.
  const makeInstant = (y, m, d) => {
    // Guess offset using noon of that day to avoid DST edge (IST has no DST).
    const guess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const off = tzOffsetMinutes(guess, TZ); // minutes east of UTC
    return new Date(Date.UTC(y, m - 1, d, targetHour, targetMin, 0) - off * 60000);
  };

  let candidate = makeInstant(Y, M, D);
  if (candidate.getTime() <= from.getTime()) {
    const tomorrow = new Date(Date.UTC(Y, M - 1, D + 1, 12));
    const t = istDateString(tomorrow).split('-').map(Number);
    candidate = makeInstant(t[0], t[1], t[2]);
  }
  return { iso: candidate.toISOString(), human: istHuman(candidate) };
}
