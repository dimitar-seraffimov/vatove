import type { Server } from "node:http";

import { createApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabasePool } from "./database.js";
import { ServiceReadinessChecker } from "./health.js";
import { ConfluentKafkaPublisher } from "./kafka.js";
import { errorContext, logger } from "./logger.js";
import { OutboxDispatcher } from "./outbox.js";
import { PostgresActivitiesStore, PostgresSyncRunsStore } from "./repositories.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const pool = createDatabasePool(config.databaseUrl);
  pool.on("error", (error) => {
    logger.error("Idle PostgreSQL client failed", errorContext(error));
  });
  const publisher = new ConfluentKafkaPublisher(
    config.kafkaBrokers,
    config.kafkaIngestionTopic,
  );
  const syncRuns = new PostgresSyncRunsStore(pool, config.kafkaIngestionTopic);
  const activities = new PostgresActivitiesStore(pool);
  const readiness = new ServiceReadinessChecker(pool, publisher);
  const dispatcher = new OutboxDispatcher(
    pool,
    publisher,
    logger,
    config.outboxPollIntervalMs,
    config.outboxBatchSize,
  );

  await publisher.connect();
  const app = createApp({
    syncRuns,
    activities,
    readiness,
    logger,
    appTimezone: config.appTimezone,
  });
  const server = await listen(app, config.port);
  dispatcher.start();
  logger.info("Vatove API is listening", { port: config.port, nodeEnv: config.nodeEnv });

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("Graceful shutdown started", { signal });
    const deadline = setTimeout(() => {
      logger.error("Graceful shutdown timed out");
      process.exitCode = 1;
      server.closeAllConnections();
    }, 15_000);
    deadline.unref();

    await Promise.all([closeServer(server), dispatcher.stop()]);
    await publisher.disconnect();
    await pool.end();
    clearTimeout(deadline);
    logger.info("Graceful shutdown completed", { signal });
  };

  const handleSignal = (signal: NodeJS.Signals): void => {
    void shutdown(signal).catch((error: unknown) => {
      logger.error("Graceful shutdown failed", { signal, ...errorContext(error) });
      process.exitCode = 1;
    });
  };
  process.once("SIGINT", () => handleSignal("SIGINT"));
  process.once("SIGTERM", () => handleSignal("SIGTERM"));
}

function listen(app: ReturnType<typeof createApp>, port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => resolve(server));
    server.once("error", reject);
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}

void main().catch((error: unknown) => {
  logger.error("Vatove API failed to start", errorContext(error));
  process.exitCode = 1;
});
