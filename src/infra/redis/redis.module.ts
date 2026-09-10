import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import type { AppConfiguration } from '../../config/configuration';
import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';

/**
 * Provides a single, shared ioredis connection for presence, caching and
 * rate limiting.
 *
 * Note: BullMQ needs its own connections (and `maxRetriesPerRequest: null`),
 * so the queue layer (Phase 5) will create dedicated clients instead of
 * reusing this one for blocking commands.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>): Redis => {
        const logger = new Logger(RedisModule.name);

        const client = new Redis({
          host: config.get('redis.host', { infer: true }),
          port: config.get('redis.port', { infer: true }),
          password: config.get('redis.password', { infer: true }),
          db: config.get('redis.db', { infer: true }),
          lazyConnect: false,
          // Bounded retry strategy with capped backoff.
          retryStrategy: (times) => Math.min(times * 200, 5_000),
          maxRetriesPerRequest: 3,
          enableReadyCheck: true,
        });

        client.on('connect', () => logger.log('Redis connection established'));
        client.on('ready', () => logger.log('Redis client ready'));
        client.on('error', (error: Error) => logger.error(`Redis error: ${error.message}`));
        client.on('close', () => logger.warn('Redis connection closed'));

        return client;
      },
    },
    RedisService,
  ],
  exports: [REDIS_CLIENT, RedisService],
})
export class RedisModule {}
