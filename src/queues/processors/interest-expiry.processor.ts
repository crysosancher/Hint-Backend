import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { InterestsService } from '../../modules/interests/interests.service';
import { QueueProcessor } from '../queue-processor.base';
import { QUEUE_CONNECTION, QUEUE_NAMES } from '../queue.constants';

/**
 * Interest expiry sweep.
 *
 * Expiry is also applied lazily whenever an interest is listed or answered, so
 * this is the durable half of the rule: it flips every overdue `sent` interest
 * to `expired`, freeing the unique partial index that treats `sent` as pending.
 * The sweep is idempotent, which is what makes a retried or duplicated job
 * harmless.
 */
@Injectable()
export class InterestExpiryProcessor extends QueueProcessor {
  protected readonly queueName = QUEUE_NAMES.interestExpiry;

  constructor(
    @Inject(QUEUE_CONNECTION) connection: ConnectionOptions,
    config: ConfigService<AppConfiguration, true>,
    private readonly interests: InterestsService,
  ) {
    super(connection, config);
  }

  process(): Promise<number> {
    return this.interests.expireOverdue();
  }
}
