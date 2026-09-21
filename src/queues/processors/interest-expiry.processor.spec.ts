import { ConfigService } from '@nestjs/config';
import type { ConnectionOptions } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { InterestsService } from '../../modules/interests/interests.service';
import { QUEUE_NAMES } from '../queue.constants';
import { InterestExpiryProcessor } from './interest-expiry.processor';

class FakeInterests {
  sweeps = 0;
  overdue = 2;

  async expireOverdue(): Promise<number> {
    this.sweeps += 1;
    return this.overdue;
  }
}

const configFake = { get: (): number => 5 } as unknown as ConfigService<AppConfiguration, true>;

const queueNameOf = (processor: object): string =>
  (processor as unknown as { queueName: string }).queueName;

describe('InterestExpiryProcessor', () => {
  let interests: FakeInterests;
  let processor: InterestExpiryProcessor;

  beforeEach(() => {
    interests = new FakeInterests();
    processor = new InterestExpiryProcessor(
      {} as ConnectionOptions,
      configFake,
      interests as unknown as InterestsService,
    );
  });

  it('consumes the interest-expiry queue', () => {
    expect(queueNameOf(processor)).toBe(QUEUE_NAMES.interestExpiry);
  });

  it('delegates the sweep to InterestsService.expireOverdue', async () => {
    await expect(processor.process()).resolves.toBe(2);
    expect(interests.sweeps).toBe(1);
  });
});
