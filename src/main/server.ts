import { buildContainer } from './container.js';
import { buildApp } from './app.js';
import { logger } from '../infrastructure/logging/logger.js';

async function main(): Promise<void> {
  const container = await buildContainer();
  const app = buildApp(container);

  const server = app.listen(container.env.PORT, () => {
    logger.info({ port: container.env.PORT }, 'SuroPark API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'graceful shutdown started');
    // Stop accepting new work; let in-flight requests drain (TRD §17.2).
    server.close();
    await container.db.destroy().catch(() => undefined);
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal boot error');
  process.exit(1);
});
