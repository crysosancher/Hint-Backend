import type { Queue } from 'bullmq';
import { QueueLifecycle } from './queue-lifecycle.service';

class FakeQueue {
  closed = false;

  constructor(readonly name: string) {}

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FailingQueue extends FakeQueue {
  async close(): Promise<void> {
    throw new Error('connection lost');
  }
}

describe('QueueLifecycle', () => {
  it('closes every producer on shutdown', async () => {
    const interest = new FakeQueue('interest-expiry');
    const presence = new FakeQueue('presence-expiry');
    const cleanup = new FakeQueue('location-cleanup');

    const lifecycle = new QueueLifecycle(
      interest as unknown as Queue,
      presence as unknown as Queue,
      cleanup as unknown as Queue,
    );

    await lifecycle.onModuleDestroy();

    expect([interest.closed, presence.closed, cleanup.closed]).toEqual([true, true, true]);
  });

  it('does not let one failing close block the others', async () => {
    const failing = new FailingQueue('interest-expiry');
    const presence = new FakeQueue('presence-expiry');
    const cleanup = new FakeQueue('location-cleanup');

    const lifecycle = new QueueLifecycle(
      failing as unknown as Queue,
      presence as unknown as Queue,
      cleanup as unknown as Queue,
    );

    await expect(lifecycle.onModuleDestroy()).resolves.toBeUndefined();
    expect([presence.closed, cleanup.closed]).toEqual([true, true]);
  });
});
