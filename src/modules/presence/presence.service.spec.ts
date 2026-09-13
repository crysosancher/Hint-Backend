import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../config/configuration';
import { RedisService } from '../../infra/redis/redis.service';
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
  let service: PresenceService;

  beforeEach(() => {
    redis = new FakeRedis();
    service = new PresenceService(
      configFake as unknown as ConfigService<AppConfiguration, true>,
      redis as unknown as RedisService,
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
});
