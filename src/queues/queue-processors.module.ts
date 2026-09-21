import { Module } from '@nestjs/common';
import { InterestsModule } from '../modules/interests/interests.module';
import { LocationModule } from '../modules/location/location.module';
import { PresenceModule } from '../modules/presence/presence.module';
import { InterestExpiryProcessor } from './processors/interest-expiry.processor';
import { LocationCleanupProcessor } from './processors/location-cleanup.processor';
import { PresenceExpiryProcessor } from './processors/presence-expiry.processor';
import { QueueSchedulerService } from './queue-schedulers.service';
import { QueuesModule } from './queues.module';

/**
 * BullMQ *consumers* — imported by the worker process only (`worker.ts`).
 *
 * Reuses the same feature services the API uses, so queue jobs and HTTP
 * requests share one implementation of the business rules (interest expiry is
 * literally the same `InterestsService.expireOverdue()` either way).
 */
@Module({
  imports: [QueuesModule, InterestsModule, PresenceModule, LocationModule],
  providers: [
    InterestExpiryProcessor,
    PresenceExpiryProcessor,
    LocationCleanupProcessor,
    QueueSchedulerService,
  ],
})
export class QueueProcessorsModule {}
