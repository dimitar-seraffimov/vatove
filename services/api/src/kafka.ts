import { KafkaJS } from "@confluentinc/kafka-javascript";

import type { DependencyHealth } from "./health.js";

export interface MessagePublisher extends DependencyHealth {
  connect(): Promise<void>;
  publish(topic: string, key: string, value: string): Promise<void>;
  disconnect(): Promise<void>;
}

type KafkaInstance = InstanceType<typeof KafkaJS.Kafka>;
type Producer = ReturnType<KafkaInstance["producer"]>;
type Admin = ReturnType<KafkaInstance["admin"]>;

export class ConfluentKafkaPublisher implements MessagePublisher {
  private readonly producer: Producer;
  private readonly admin: Admin;
  private connected = false;

  constructor(
    brokers: string[],
    private readonly expectedTopic: string,
  ) {
    const kafka = new KafkaJS.Kafka();
    const commonConfig = {
      "bootstrap.servers": brokers.join(","),
      "client.id": "vatove-api",
    };
    this.producer = kafka.producer({
      ...commonConfig,
      "enable.idempotence": true,
      acks: -1,
      "message.timeout.ms": 10_000,
      "request.timeout.ms": 5_000,
    });
    this.admin = kafka.admin(commonConfig);
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    try {
      await this.producer.connect();
      await this.admin.connect();
      this.connected = true;
    } catch (error) {
      await Promise.allSettled([this.admin.disconnect(), this.producer.disconnect()]);
      throw error;
    }
  }

  async publish(topic: string, key: string, value: string): Promise<void> {
    if (!this.connected) throw new Error("Kafka publisher is not connected");
    await this.producer.send({
      topic,
      messages: [
        {
          key,
          value,
          headers: {
            "content-type": "application/json",
            "schema-version": "1",
          },
        },
      ],
    });
  }

  async check(): Promise<void> {
    if (!this.connected) throw new Error("Kafka publisher is not connected");
    const topics = await this.admin.listTopics({ timeout: 2_000 });
    if (!topics.includes(this.expectedTopic)) {
      throw new Error(`Kafka topic ${this.expectedTopic} does not exist`);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await Promise.allSettled([this.admin.disconnect(), this.producer.disconnect()]);
  }
}
