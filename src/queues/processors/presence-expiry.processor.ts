import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions, Job } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../../modules/location/location.service';
import { PresenceService } from '../../modules/presence/presence.service';
import { QueueProcessor } from '../queue-processor.base';
import { type PresenceExpiryJobData, QUEUE_CONNECTION, QUEUE_NAMES } from '../queue.constants';

/**
 * Presence expiry.
 *
 * Redis has already dropped the presence key by the time this job runs (the
 * delay equals the session TTL), so the session no longer exists — what is left
 * behind is the user's location document. That is the piece this processor
 * removes: a location only means something while its owner is discoverable.
 *
 * Re-activation replaces the pending job, so a fire while the session is still
 * active belongs to a newer job and is skipped rather than deleting a location
 * the user is still using. This is also the natural hook for the Phase 5
 * `nearby.user.disappeared` websocket event.
 */
@Injectable()
export class PresenceExpiryProcessor extends QueueProcessor<PresenceExpiryJobData> {
  protected readonly queueName = QUEUE_NAMES.presenceExpiry;

  constructor(
    @Inject(QUEUE_CONNECTION) connection: ConnectionOptions,
    config: ConfigService<AppConfiguration, true>,
    private readonly presence: PresenceService,
    private readonly locations: LocationService,
  ) {
    super(connection, config);
  }

  async process(job: Job<PresenceExpiryJobData>): Promise<void> {
    const { userId } = job.data;

    if (await this.presence.isActive(userId)) return;

    await this.locations.delete(userId);
  }
}
