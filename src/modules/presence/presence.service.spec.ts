import { ConfigService } from '@nestjs/config';
import type { Queue } from 'bullmq';
import type { AppConfiguration } from '../../config/configuration';
import { RedisService } from '../../infra/redis/redis.service';
import {
  type PresenceExpiryJobData,
  QUEUE_JOBS,
  presenceExpiryJobId,
} from '../../queues/queue.constants';
import { NearbyStatus } from './dto/nearby-session-response.dto';
import { PresenceService } from './presence.service';

interface StoredValue {
  json: string;
  ttlSeconds?: number;
}

/** In-memory stand-in for RedisService, preserving JSON + TTL semantics. */
class FakeRedis {
  readonly store = new Map<string, StoredValue>();

  key(...parts: (string | number)[]): string {
    return ['hint', ...parts].join(':');
  }

  async setJson<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    this.store.set(key, { json: JSON.stringify(value), ttlSeconds });
  }

  async getJson<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    return entry ? (JSON.parse(entry.json) as T) : null;
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  async ttl(key: string): Promise<number> {
    const entry = this.store.get(key);
    if (!entry) return -2;
    return entry.ttlSeconds ?? -1;
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

interface AddedJob {
  name: string;
  data: unknown;
  opts?: { jobId?: string; delay?: number; removeOnComplete?: boolean };
}

/** In-memory stand-in for the BullMQ presence-expiry producer. */
class FakeQueue {
  readonly added: AddedJob[] = [];
  readonly removed: string[] = [];

  async add(name: string, data: unknown, opts?: AddedJob['opts']): Promise<{ id?: string }> {
    this.added.push({ name, data, opts });
    return { id: opts?.jobId };
  }

  async remove(jobId: string): Promise<number> {
    this.removed.push(jobId);
    return 1;
  }
}

const CONFIG: Record<string, number> = {
  'nearby.sessionTtlMinutes': 30,
  'nearby.locationMaxAccuracyMeters': 100,
};

const configFake = {
  get: (key: string): number | undefined => CONFIG[key],
};

describe('PresenceService', () => {
  const userId = '665f1b2c3d4e5f6a7b8c9d0e';
  let redis: FakeRedis;
  let queue: FakeQueue;
  let service: PresenceService;

  beforeEach(() => {
    redis = new FakeRedis();
    queue = new FakeQueue();
    service = new PresenceService(
      configFake as unknown as ConfigService<AppConfiguration, true>,
      redis as unknown as RedisService,
      queue as unknown as Queue<PresenceExpiryJobData>,
    );
  });

  it('activates Nearby Mode with a TTL-derived expiry', async () => {
    const session = await service.activate(userId);

    expect(session).toMatchObject({
      userId,
      status: NearbyStatus.Active,
      ttlSeconds: 30 * 60,
    });
    expect(typeof session.startedAt).toBe('string');
    expect(typeof session.expiresAt).toBe('string');
    await expect(service.isActive(userId)).resolves.toBe(true);
  });

  it('renews the session in place on a second activation', async () => {
    await service.activate(userId);
    await service.activate(userId);

    expect(redis.store.size).toBe(1);
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      status: NearbyStatus.Active,
    });
  });

  it('deactivates and clears the session', async () => {
    await service.activate(userId);

    const session = await service.deactivate(userId);

    expect(session).toMatchObject({ userId, status: NearbyStatus.Inactive });
    await expect(service.isActive(userId)).resolves.toBe(false);
  });

  it('reports inactive when no session exists', async () => {
    await expect(service.getStatus(userId)).resolves.toMatchObject({
      userId,
      status: NearbyStatus.Inactive,
    });
  });

  it('reports the remaining TTL for an active session', async () => {
    await service.activate(userId);

    const status = await service.getStatus(userId);

    expect(status.status).toBe(NearbyStatus.Active);
    expect(status.ttlSeconds).toBe(30 * 60);
  });

  it('treats a key without an expiry as inactive and cleans it up', async () => {
    const key = redis.key('presence', userId);
    redis.store.set(key, {
      json: JSON.stringify({
        userId,
        status: 'active',
        startedAt: 'x',
        expiresAt: 'y',
      }),
      ttlSeconds: undefined,
    });

    const status = await service.getStatus(userId);

    expect(status.status).toBe(NearbyStatus.Inactive);
    expect(redis.store.has(key)).toBe(false);
  });

  describe('presence-expiry job', () => {
    it('arms a delayed job when a session is activated', async () => {
      await service.activate(userId);

      expect(queue.added).toHaveLength(1);
      expect(queue.added[0]).toMatchObject({
        name: QUEUE_JOBS.presenceExpiry,
        data: { userId },
        opts: {
          jobId: presenceExpiryJobId(userId),
          delay: 30 * 60 * 1000,
          removeOnComplete: true,
        },
      });
    });

    it('uses a job id BullMQ accepts (custom ids may not contain ":")', () => {
      // BullMQ's `Job.validateOptions` throws `Custom Id cannot contain :`
      // unless the id has exactly two colons (a legacy repeatable-job shape).
      // Presence is the only producer that sets an explicit `jobId`, and the
      // throw escapes as a 500 on POST /api/v1/nearby/activate — this is the
      // guard against reintroducing a colon separator.
      expect(presenceExpiryJobId(userId)).not.toContain(':');
    });

    it('replaces the pending expiry when a session is renewed', async () => {
      await service.activate(userId);
      await service.activate(userId);

      expect(queue.removed).toContain(presenceExpiryJobId(userId));
      expect(queue.added).toHaveLength(2);
    });

    it('cancels the pending expiry when the session is deactivated', async () => {
      await service.activate(userId);
      queue.removed.length = 0;

      await service.deactivate(userId);

      expect(queue.removed).toEqual([presenceExpiryJobId(userId)]);
    });

    it('still activates when a pending job cannot be removed (locked)', async () => {
      queue.remove = async () => {
        throw new Error('Job is locked');
      };

      await expect(service.activate(userId)).resolves.toMatchObject({
        status: NearbyStatus.Active,
      });
      expect(queue.added).toHaveLength(1);
    });
  });
});
