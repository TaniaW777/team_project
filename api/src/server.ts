import { createApp } from './app.ts';
import { connectDatabase, disconnectDatabase } from './config/db.ts';
import { env } from './config/env.ts';
import { logger } from './shared/logger.ts';

// Lab reference: section 1.4 (src/server.ts).

async function main(): Promise<void> {
  // EVENTPASS MODIFICATION OF THE LAB (ADR-008):
  // the lab awaited connectDatabase() without handling failure, which ended
  // the process with an unhandled rejection and a raw stack trace. We now log
  // one clear line and exit with code 1 WITHOUT opening the HTTP port, so the
  // API never runs in an invalid state (no database).
  try {
    await connectDatabase();
  } catch (error) {
    // Only the error name and message: never the connection string.
    const reason =
      error instanceof Error ? `${error.name}: ${error.message}` : 'unknown';
    logger.fatal({ reason }, 'Cannot connect to MongoDB: the API will not start');
    await disconnectDatabase().catch(() => undefined);
    // exitCode (not process.exit) lets the logger flush before Node exits.
    process.exitCode = 1;
    return;
  }

  const server = createApp().listen(env.PORT, () => {
    logger.info(`API listening on http://localhost:${env.PORT}`);
  });

  // Graceful shutdown: finish in-flight requests, then close the database.
  async function shutdown(signal: string) {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await disconnectDatabase();
      process.exit(0);
    });
  }

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

await main();
