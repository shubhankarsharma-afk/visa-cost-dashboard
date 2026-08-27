// Tiny structured logger — timestamps in IST for operational clarity.
function ts() {
  return new Date().toLocaleString('en-GB', { timeZone: 'Asia/Kolkata' }) + ' IST';
}
function fmt(level, args) {
  return [`[${ts()}] [${level}]`, ...args];
}
export const logger = {
  info: (...a) => console.log(...fmt('INFO', a)),
  warn: (...a) => console.warn(...fmt('WARN', a)),
  error: (...a) => console.error(...fmt('ERROR', a)),
  debug: (...a) => {
    if (process.env.DEBUG) console.log(...fmt('DEBUG', a));
  },
};
