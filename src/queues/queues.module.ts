import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type ConnectionOptions } from 'bullmq';
import type { AppConfiguration } from '../config/configuration';
import { QueueLifecycle } from './queue-lifecycle.service';
import {
  INTEREST_EXPIRY_QUEUE,
  LOCATION_CLEANUP_QUEUE,
  PRESENCE_EXPIRY_QUEUE,
  QUEUE_CONNECTION,
  QUEUE_NAMES,
} from './queue.constants';

/** Builds one `Queue` producer bound to the shared connection + prefix. */
const queueProvider = (provide: symbol, name: string) => ({
  provide,
  inject: [QUEUE_CONNECTION, ConfigService],
  useFactory: (
    connection: ConnectionOptions,
    config: ConfigService<AppConfiguration, true>,
  ): Queue =>
    new Queue(name, {
      connection,
      // BullMQ builds its own key namespace; without the prefix every
      // environment would share one set of queue keys in the same Redis db.
      prefix: config.get('queue.prefix', { infer: true }),
    }),
});

/**
 * BullMQ *producers*.
 *
 * Only `Queue` instances live here — no `Worker` is created, so importing this
 * module into the HTTP process can never make the API consume jobs. The worker
 * process (`worker.ts`) registers the matching consumers through
 * `QueueProcessorsModule`.
 *
 * BullMQ is deliberately given plain connection options instead of the shared
 * ioredis client from `RedisModule`: blocking consumers need their own
 * connection with `maxRetriesPerRequest: null`, which BullMQ configures itself
 * when it owns the connection.
 */
@Module({
  providers: [
    {
      provide: QUEUE_CONNECTION,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>): ConnectionOptions => ({
        host: config.get('redis.host', { infer: true }),
        port: config.get('redis.port', { infer: true }),
        password: config.get('redis.password', { infer: true }),
        db: config.get('redis.db', { infer: true }),
      }),
    },
    queueProvider(INTEREST_EXPIRY_QUEUE, QUEUE_NAMES.interestExpiry),
    queueProvider(PRESENCE_EXPIRY_QUEUE, QUEUE_NAMES.presenceExpiry),
    queueProvider(LOCATION_CLEANUP_QUEUE, QUEUE_NAMES.locationCleanup),
    QueueLifecycle,
  ],
  exports: [QUEUE_CONNECTION, INTEREST_EXPIRY_QUEUE, PRESENCE_EXPIRY_QUEUE, LOCATION_CLEANUP_QUEUE],
})
export class QueuesModule {}
