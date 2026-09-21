import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AppConfiguration } from '../config/configuration';
import { QUEUE_JOBS, QUEUE_SCHEDULERS } from './queue.constants';
import { QueueSchedulerService } from './queue-schedulers.service';

interface RegisteredScheduler {
  id: string;
  every: number;
  name?: string;
}

/** Records the schedulers it is asked to upsert. */
class FakeQueue {
  readonly schedulers: RegisteredScheduler[] = [];

  async upsertJobScheduler(
    id: string,
    repeat: { every: number },
    template?: { name?: string },
  ): Promise<unknown> {
    this.schedulers.push({ id, every: repeat.every, name: template?.name });
    return {};
  }
}

const CONFIG: Record<string, number> = {
  'queue.interestExpiryIntervalMs': 3_600_000,
  'queue.locationCleanupIntervalMs': 60_000,
};

const configFake = { get: (key: string): number | undefined => CONFIG[key] };

describe('QueueSchedulerService', () => {
  let interestExpiry: FakeQueue;
  let locationCleanup: FakeQueue;
  let service: QueueSchedulerService;

  beforeEach(() => {
    interestExpiry = new FakeQueue();
    locationCleanup = new FakeQueue();
    service = new QueueSchedulerService(
      configFake as unknown as ConfigService<AppConfiguration, true>,
      interestExpiry as unknown as Queue,
      locationCleanup as unknown as Queue,
    );
  });

  it('registers the interest-expiry sweep at the configured interval', async () => {
    await service.onModuleInit();

    expect(interestExpiry.schedulers).toEqual([
      {
        id: QUEUE_SCHEDULERS.interestExpirySweep,
        every: 3_600_000,
        name: QUEUE_JOBS.interestExpirySweep,
      },
    ]);
  });

  it('registers the location-cleanup sweep at the configured interval', async () => {
    await service.onModuleInit();

    expect(locationCleanup.schedulers).toEqual([
      {
        id: QUEUE_SCHEDULERS.locationCleanupSweep,
        every: 60_000,
        name: QUEUE_JOBS.locationCleanupSweep,
      },
    ]);
  });
});
