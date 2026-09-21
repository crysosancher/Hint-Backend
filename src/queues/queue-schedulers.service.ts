import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AppConfiguration } from '../config/configuration';
import {
  INTEREST_EXPIRY_QUEUE,
  LOCATION_CLEANUP_QUEUE,
  QUEUE_JOBS,
  QUEUE_SCHEDULERS,
} from './queue.constants';

/**
 * Registers the repeatable sweeps through BullMQ's Job Schedulers.
 *
 * Runs in the worker process only. `upsertJobScheduler` is idempotent, so every
 * worker boot re-asserts the schedule without duplicating it, and the schedule
 * survives a restart because it lives in Redis rather than in this process.
 */
@Injectable()
export class QueueSchedulerService implements OnModuleInit {
  private readonly logger = new Logger(QueueSchedulerService.name);

  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    @Inject(INTEREST_EXPIRY_QUEUE) private readonly interestExpiry: Queue,
    @Inject(LOCATION_CLEANUP_QUEUE) private readonly locationCleanup: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const interestIntervalMs = this.config.get('queue.interestExpiryIntervalMs', { infer: true });
    const cleanupIntervalMs = this.config.get('queue.locationCleanupIntervalMs', { infer: true });

    await this.interestExpiry.upsertJobScheduler(
      QUEUE_SCHEDULERS.interestExpirySweep,
      { every: interestIntervalMs },
      {
        name: QUEUE_JOBS.interestExpirySweep,
        opts: { removeOnComplete: true, removeOnFail: true },
      },
    );

    await this.locationCleanup.upsertJobScheduler(
      QUEUE_SCHEDULERS.locationCleanupSweep,
      { every: cleanupIntervalMs },
      {
        name: QUEUE_JOBS.locationCleanupSweep,
        opts: { removeOnComplete: true, removeOnFail: true },
      },
    );

    this.logger.log(
      `Job schedulers registered (interest-expiry every ${interestIntervalMs} ms, ` +
        `location-cleanup every ${cleanupIntervalMs} ms)`,
    );
  }
}
