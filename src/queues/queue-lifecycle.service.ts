import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  INTEREST_EXPIRY_QUEUE,
  LOCATION_CLEANUP_QUEUE,
  PRESENCE_EXPIRY_QUEUE,
} from './queue.constants';

/**
 * Closes the queue producers on shutdown.
 *
 * Both entry points call `app.enableShutdownHooks()`, so a `SIGTERM` lets
 * NestJS run `onModuleDestroy` and close the Redis connections BullMQ opened
 * for the producers instead of leaving them dangling.
 */
@Injectable()
export class QueueLifecycle implements OnModuleDestroy {
  private readonly logger = new Logger(QueueLifecycle.name);

  constructor(
    @Inject(INTEREST_EXPIRY_QUEUE) private readonly interestExpiry: Queue,
    @Inject(PRESENCE_EXPIRY_QUEUE) private readonly presenceExpiry: Queue,
    @Inject(LOCATION_CLEANUP_QUEUE) private readonly locationCleanup: Queue,
  ) {}

  async onModuleDestroy(): Promise<void> {
    const queues = [this.interestExpiry, this.presenceExpiry, this.locationCleanup];

    await Promise.all(
      queues.map((queue) =>
        queue.close().catch((error: Error) => {
          this.logger.warn(`Failed to close queue ${queue.name}: ${error.message}`);
        }),
      ),
    );
  }
}
