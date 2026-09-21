import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../../modules/location/location.service';
import { QueueProcessor } from '../queue-processor.base';
import { QUEUE_CONNECTION, QUEUE_NAMES } from '../queue.constants';

/**
 * Location cleanup sweep.
 *
 * Deletes every fix older than the discovery freshness window. The MVP keeps
 * only the latest active location (never a movement history), so a fix that has
 * aged out is useless to discovery and should not be retained.
 *
 * This is the safety net for sessions that ended without a presence-expiry job:
 * an explicit deactivation, a crashed worker or a lost job.
 */
@Injectable()
export class LocationCleanupProcessor extends QueueProcessor {
  protected readonly queueName = QUEUE_NAMES.locationCleanup;

  constructor(
    @Inject(QUEUE_CONNECTION) connection: ConnectionOptions,
    config: ConfigService<AppConfiguration, true>,
    private readonly locations: LocationService,
  ) {
    super(connection, config);
  }

  process(): Promise<number> {
    const maxAgeMs = this.config.get('nearby.locationMaxAgeSeconds', { infer: true }) * 1000;
    return this.locations.deleteStale(maxAgeMs);
  }
}
