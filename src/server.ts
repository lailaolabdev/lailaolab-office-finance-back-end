import app from './app';
import { env } from './config/env';
import logger from './utils/logger';
import { startScheduler, stopScheduler } from './services/scheduler.service';

const server = app.listen(env.PORT, () => {
  logger.info(`🚀 Server running at http://localhost:${env.PORT}${env.API_PREFIX}`);
  logger.info(`📊 Health: http://localhost:${env.PORT}${env.API_PREFIX}/health`);
  logger.info(`🌍 Environment: ${env.NODE_ENV}`);

  if (env.NODE_ENV !== 'test') {
    startScheduler();
  }
});

const shutdown = (signal: string) => {
  logger.info(`${signal} received: closing server`);
  stopScheduler();
  server.close(() => {
    logger.info('Server closed');
    process.exit(0);
  });
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
