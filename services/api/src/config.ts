import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65_535).default(3000),
  APP_TIMEZONE: z.string().min(1).default("Europe/London"),
  DATABASE_URL: z.string().min(1),
  KAFKA_BROKERS: z.string().min(1).default("localhost:29092"),
  KAFKA_INGESTION_TOPIC: z.string().min(1).default("incoming_activities.v1"),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(50).default(500),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(100).default(20),
});

export interface AppConfig {
  nodeEnv: "development" | "test" | "production";
  port: number;
  appTimezone: string;
  databaseUrl: string;
  kafkaBrokers: string[];
  kafkaIngestionTopic: string;
  outboxPollIntervalMs: number;
  outboxBatchSize: number;
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const kafkaBrokers = parsed.KAFKA_BROKERS.split(",")
    .map((broker) => broker.trim())
    .filter(Boolean);

  if (kafkaBrokers.length === 0) {
    throw new Error("KAFKA_BROKERS must contain at least one broker");
  }

  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: parsed.APP_TIMEZONE }).format();
  } catch {
    throw new Error(`APP_TIMEZONE is not a valid IANA timezone: ${parsed.APP_TIMEZONE}`);
  }

  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    appTimezone: parsed.APP_TIMEZONE,
    databaseUrl: parsed.DATABASE_URL,
    kafkaBrokers,
    kafkaIngestionTopic: parsed.KAFKA_INGESTION_TOPIC,
    outboxPollIntervalMs: parsed.OUTBOX_POLL_INTERVAL_MS,
    outboxBatchSize: parsed.OUTBOX_BATCH_SIZE,
  };
}
