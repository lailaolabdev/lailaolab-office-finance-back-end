import cron, { ScheduledTask } from 'node-cron';
import logger from '../utils/logger';
import { notificationService } from './notification.service';

const TZ = process.env.CRON_TIMEZONE ?? 'Asia/Vientiane';

const tasks: ScheduledTask[] = [];

/**
 * Schedule recurring notification jobs. Idempotent — calling start() twice
 * is a no-op (existing tasks are returned). All jobs run in Asia/Vientiane
 * by default, overridable with CRON_TIMEZONE.
 *
 * Schedule:
 *   - Daily reminder      → 17:00 every day
 *   - Low balance check   → every 6 hours (00:00, 06:00, 12:00, 18:00)
 */
export function startScheduler() {
  if (tasks.length > 0) {
    logger.warn('Scheduler already running — start() ignored');
    return tasks;
  }

  // 9.3 Daily Report Reminder
  const dailyReminder = cron.schedule(
    '0 17 * * *',
    async () => {
      try {
        logger.info('[cron] daily-reminder firing');
        await notificationService.sendDailyReminder();
      } catch (err) {
        logger.error(`[cron] daily-reminder failed: ${(err as Error).message}`);
      }
    },
    { timezone: TZ },
  );
  tasks.push(dailyReminder);

  // 9.5 Low Balance Alert
  const lowBalance = cron.schedule(
    '0 */6 * * *',
    async () => {
      try {
        logger.info('[cron] low-balance check firing');
        await notificationService.checkLowBalance();
      } catch (err) {
        logger.error(`[cron] low-balance failed: ${(err as Error).message}`);
      }
    },
    { timezone: TZ },
  );
  tasks.push(lowBalance);

  logger.info(`Scheduler started — ${tasks.length} jobs in ${TZ}`);
  return tasks;
}

export function stopScheduler() {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  logger.info('Scheduler stopped');
}
