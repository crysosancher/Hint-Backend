import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions, Job } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../../modules/location/location.service';
import { PresenceService } from '../../modules/presence/presence.service';
import { type PresenceExpiryJobData, QUEUE_NAMES } from '../queue.constants';
import { PresenceExpiryProcessor } from './presence-expiry.processor';

/** Toggleable presence stand-in. */
class FakePresence {
  active = false;

  async isActive(): Promise<boolean> {
    return this.active;
  }
}

class FakeLocations {
  readonly deleted: string[] = [];

  async delete(userId: string): Promise<void> {
    this.deleted.push(userId);
  }
}

const configFake = { get: (): number => 5 } as unknown as ConfigService<AppConfiguration, true>;

const queueNameOf = (processor: object): string =>
  (processor as unknown as { queueName: string }).queueName;

describe('PresenceExpiryProcessor', () => {
  const userId = '665f1b2c3d4e5f6a7b8c9d0e';
  const job = { data: { userId } } as Job<PresenceExpiryJobData>;

  let presence: FakePresence;
  let locations: FakeLocations;
  let processor: PresenceExpiryProcessor;

  beforeEach(() => {
    presence = new FakePresence();
    locations = new FakeLocations();
    processor = new PresenceExpiryProcessor(
      {} as ConnectionOptions,
      configFake,
      presence as unknown as PresenceService,
      locations as unknown as LocationService,
    );
  });

  it('consumes the presence-expiry queue', () => {
    expect(queueNameOf(processor)).toBe(QUEUE_NAMES.presenceExpiry);
  });

  it('drops the location of a session that has lapsed', async () => {
    presence.active = false;

    await processor.process(job);

    expect(locations.deleted).toEqual([userId]);
  });

  it('keeps the location when the session was renewed', async () => {
    presence.active = true;

    await processor.process(job);

    expect(locations.deleted).toEqual([]);
  });
});
