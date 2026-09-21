import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '../src/infra/redis/redis.constants';
import { InterestExpiryProcessor } from '../src/queues/processors/interest-expiry.processor';
import { LocationCleanupProcessor } from '../src/queues/processors/location-cleanup.processor';
import { PresenceExpiryProcessor } from '../src/queues/processors/presence-expiry.processor';
import {
  INTEREST_EXPIRY_QUEUE,
  LOCATION_CLEANUP_QUEUE,
  PRESENCE_EXPIRY_QUEUE,
} from '../src/queues/queue.constants';
import { QueueSchedulerService } from '../src/queues/queue-schedulers.service';
import { WorkerModule } from '../src/worker.module';

/**
 * Boots the **real** `WorkerModule` — the same graph `worker.ts` starts — with
 * Mongo, Redis and the BullMQ producers swapped for fakes.
 *
 * Together with `app.e2e-spec.ts` (which proves the HTTP graph) this is what
 * catches a missing provider/export or a circular import in the queue layer
 * without needing Redis reachable.
 */
describe('Worker module (e2e)', () => {
  const connectionFake = {
    models: {} as Record<string, unknown>,
    model: (name: string): { modelName: string } => ({ modelName: name }),
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
    readyState: 1,
    asPromise: async (): Promise<unknown> => connectionFake,
    close: async (): Promise<void> => undefined,
  };

  const redisFake = {
    status: 'ready',
    on: (): unknown => redisFake,
  };

  const queueFake = {
    add: async (): Promise<{ id?: string }> => ({}),
    remove: async (): Promise<number> => 0,
    upsertJobScheduler: async (): Promise<unknown> => ({}),
    close: async (): Promise<void> => undefined,
  };

  it('wires every queue consumer and the Job Scheduler service', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [WorkerModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connectionFake)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisFake)
      .overrideProvider(INTEREST_EXPIRY_QUEUE)
      .useValue(queueFake)
      .overrideProvider(PRESENCE_EXPIRY_QUEUE)
      .useValue(queueFake)
      .overrideProvider(LOCATION_CLEANUP_QUEUE)
      .useValue(queueFake)
      .compile();

    // `compile()` instantiates providers without running lifecycle hooks, so no
    // real Redis connection is opened by the BullMQ `Worker` instances.
    expect(moduleRef.get(InterestExpiryProcessor)).toBeInstanceOf(InterestExpiryProcessor);
    expect(moduleRef.get(PresenceExpiryProcessor)).toBeInstanceOf(PresenceExpiryProcessor);
    expect(moduleRef.get(LocationCleanupProcessor)).toBeInstanceOf(LocationCleanupProcessor);
    expect(moduleRef.get(QueueSchedulerService)).toBeInstanceOf(QueueSchedulerService);

    await moduleRef.close();
  });
});
