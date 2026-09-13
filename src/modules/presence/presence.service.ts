import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AppConfiguration } from '../../config/configuration';
import { RedisService } from '../../infra/redis/redis.service';
import { NearbySessionResponseDto, NearbyStatus } from './dto/nearby-session-response.dto';

/**
 * Shape stored in Redis at `hint:presence:<userId>`.
 *
 * The key's TTL is the source of truth for expiry — Redis drops it
 * automatically, so an expired session simply stops existing and no cron job
 * is required.
 */
export interface NearbySession {
  userId: string;
  status: 'active';
  startedAt: string;
  expiresAt: string;
}

/**
 * Nearby Mode ("presence").
 *
 * Presence is deliberately ephemeral and lives only in Redis: it answers "is
 * this user currently discoverable?" and expires on its own after
 * `nearby.sessionTtlMinutes`. The durable location itself is owned by the
 * Location module.
 */
@Injectable()
export class PresenceService {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly redis: RedisService,
  ) {}

  /**
   * Starts (or renews) Nearby Mode and returns the session. Re-activating is
   * idempotent and resets the TTL, so the client can extend a session.
   */
  async activate(userId: string): Promise<NearbySessionResponseDto> {
    const ttlSeconds = this.sessionTtlSeconds();
    const now = Date.now();
    const session: NearbySession = {
      userId,
      status: 'active',
      startedAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttlSeconds * 1000).toISOString(),
    };

    await this.redis.setJson(this.presenceKey(userId), session, ttlSeconds);

    return {
      userId,
      status: NearbyStatus.Active,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      ttlSeconds,
    };
  }

  /** Stops Nearby Mode, removing the user from active discovery. */
  async deactivate(userId: string): Promise<NearbySessionResponseDto> {
    await this.redis.del(this.presenceKey(userId));
    return { userId, status: NearbyStatus.Inactive };
  }

  /** Current session, or `inactive` when it is missing or already expired. */
  async getStatus(userId: string): Promise<NearbySessionResponseDto> {
    const key = this.presenceKey(userId);
    const session = await this.redis.getJson<NearbySession>(key);

    if (!session) {
      return { userId, status: NearbyStatus.Inactive };
    }

    const ttlSeconds = await this.redis.ttl(key);
    if (ttlSeconds <= 0) {
      // Key present but no/negative expiry — treat as expired and clean up.
      await this.redis.del(key);
      return { userId, status: NearbyStatus.Inactive };
    }

    return {
      userId,
      status: NearbyStatus.Active,
      startedAt: session.startedAt,
      expiresAt: session.expiresAt,
      ttlSeconds,
    };
  }

  /** Cheap eligibility check used by location ingestion and discovery. */
  async isActive(userId: string): Promise<boolean> {
    return this.redis.exists(this.presenceKey(userId));
  }

  /**
   * Batched eligibility check: the subset of `userIds` with an active session.
   *
   * Discovery can face many nearby candidates at once, so this issues a single
   * `MGET` instead of one round-trip per candidate. A missing key reads back as
   * `null`, which is what filters the user out.
   */
  async filterActive(userIds: string[]): Promise<string[]> {
    if (userIds.length === 0) return [];

    const values = await this.redis.client.mget(...userIds.map((userId) => this.presenceKey(userId)));
    return userIds.filter((_userId, index) => values[index] !== null);
  }

  private sessionTtlSeconds(): number {
    return this.config.get('nearby.sessionTtlMinutes', { infer: true }) * 60;
  }

  private presenceKey(userId: string): string {
    return this.redis.key('presence', userId);
  }
}
