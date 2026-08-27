// In-process scheduler using node-cron. Fires the daily update at the
// configured time IN THE CONFIGURED TIMEZONE (Asia/Kolkata). This runs
// independently of anyone opening the dashboard.
//
// NOTE: For production robustness you should ALSO enable the OS-cron /
// GitHub Actions backup (see scripts/run-update.js and .github/workflows),
// so updates still happen if the web process is restarted at 09:00.
import cron from 'node-cron';
import { config } from './config.js';
import { logger } from './logger.js';
import { runUpdate } from './services/update.js';
import { nextScheduledRun } from './services/time.js';

let task = null;

export function startScheduler() {
  if (!config.schedule.enableInProcess) {
    logger.info('In-process scheduler disabled (ENABLE_INPROCESS_SCHEDULER=false).');
    return null;
  }
  if (!cron.validate(config.schedule.cron)) {
    logger.error(`Invalid SCHEDULE_CRON "${config.schedule.cron}" — scheduler NOT started.`);
    return null;
  }

  task = cron.schedule(
    config.schedule.cron,
    async () => {
      logger.info('Scheduled trigger fired.');
      try {
        await runUpdate({ type: 'scheduled' });
      } catch (err) {
        logger.error('Scheduled update threw:', err.message);
      }
    },
    { timezone: config.schedule.timezone }
  );

  const next = nextScheduledRun();
  logger.info(
    `Scheduler started: cron="${config.schedule.cron}" tz=${config.schedule.timezone}. Next run: ${next.human}`
  );
  return task;
}

export function stopScheduler() {
  if (task) task.stop();
}
