import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../../modules/location/location.service';
import { QUEUE_NAMES } from '../queue.constants';
import { LocationCleanupProcessor } from './location-cleanup.processor';

class FakeLocations {
  readonly cutoffs: number[] = [];
  deleted = 3;

  async deleteStale(olderThanMs: number): Promise<number> {
    this.cutoffs.push(olderThanMs);
    return this.deleted;
  }
}

const CONFIG: Record<string, number> = { 'nearby.locationMaxAgeSeconds': 120 };
const configFake = { get: (key: string): number | undefined => CONFIG[key] };

describe('LocationCleanupProcessor', () => {
  let locations: FakeLocations;
  let processor: LocationCleanupProcessor;

  beforeEach(() => {
    locations = new FakeLocations();
    processor = new LocationCleanupProcessor(
      {} as ConnectionOptions,
      configFake as unknown as ConfigService<AppConfiguration, true>,
      locations as unknown as LocationService,
    );
  });

  it('consumes the location-cleanup queue', () => {
    expect((processor as unknown as { queueName: string }).queueName).toBe(
      QUEUE_NAMES.locationCleanup,
    );
  });

  it('deletes fixes older than the discovery freshness window', async () => {
    await expect(processor.process()).resolves.toBe(3);
    expect(locations.cutoffs).toEqual([120_000]);
  });
});
