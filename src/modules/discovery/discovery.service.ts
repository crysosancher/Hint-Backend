import { ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { coarsenDistance, type GeoCoordinate } from '../../common/geo/haversine';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../location/location.service';
import { PresenceService } from '../presence/presence.service';
import { ProfilesService } from '../profiles/profiles.service';
import { NearbyProfileDto } from './dto/discovery-response.dto';

/**
 * Discovery within the 250 m radius.
 *
 * The whole flow is **server-authoritative**: the caller supplies nothing but
 * their access token. Eligibility is decided from an active Nearby Mode session
 * (Redis) and the latest stored fix, the distance is computed by MongoDB's
 * `2dsphere` index, and only a coarse distance plus a safe profile ever leaves
 * the server.
 *
 * Per the approved MVP rules, discovery applies **no preference filtering** —
 * anyone who is actively discoverable, has a profile and is within 250 m is
 * eligible. Compatibility is decided by the users themselves when an interest
 * is accepted.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly presence: PresenceService,
    private readonly locations: LocationService,
    private readonly profiles: ProfilesService,
  ) {}

  /** Eligible nearby users, nearest first. */
  async findNearby(userId: string): Promise<NearbyProfileDto[]> {
    const origin = await this.requireDiscoverableOrigin(userId);

    const candidates = await this.locations.findNearby(origin, {
      radiusMeters: this.config.get('nearby.radiusMeters', { infer: true }),
      maxAgeSeconds: this.config.get('nearby.locationMaxAgeSeconds', { infer: true }),
      excludeUserId: userId,
    });
    if (candidates.length === 0) return [];

    // Presence is a second, independent gate: a fresh fix alone is not enough,
    // the user must still be in Nearby Mode right now.
    const activeIds = new Set(
      await this.presence.filterActive(candidates.map((candidate) => candidate.userId)),
    );
    const eligible = candidates.filter((candidate) => activeIds.has(candidate.userId));
    if (eligible.length === 0) return [];

    // Only users who actually completed their profile can be shown. One batched
    // fetch resolves both the "has a profile" filter and the payload.
    const profiles = await this.profiles.findManySafeProfiles(
      eligible.map((candidate) => candidate.userId),
    );

    const nearby: NearbyProfileDto[] = [];
    for (const candidate of eligible) {
      const profile = profiles.get(candidate.userId);
      if (!profile) continue;

      nearby.push({
        ...profile,
        distanceMeters: coarsenDistance(candidate.distanceMeters),
      });
    }

    return nearby.sort((a, b) => a.distanceMeters - b.distanceMeters);
  }

  /**
   * A single user's safe profile, but only when the caller could have found them
   * through `/discovery/nearby`.
   *
   * Reusing the exact same eligibility gate is what makes the 250 m rule
   * unbypassable: a direct API call for a specific id cannot reveal someone who
   * is out of range, inactive or unprofiled. Returns `null` rather than throwing
   * so the caller can answer `404` without leaking whether the user exists.
   */
  async findEligibleProfile(callerId: string, targetId: string): Promise<NearbyProfileDto | null> {
    if (callerId === targetId) return null;

    const origin = await this.requireDiscoverableOrigin(callerId);

    const candidates = await this.locations.findNearby(origin, {
      radiusMeters: this.config.get('nearby.radiusMeters', { infer: true }),
      maxAgeSeconds: this.config.get('nearby.locationMaxAgeSeconds', { infer: true }),
      excludeUserId: callerId,
    });

    const candidate = candidates.find((entry) => entry.userId === targetId);
    if (!candidate) return null;

    if (!(await this.presence.isActive(targetId))) return null;

    const profile = (await this.profiles.findManySafeProfiles([targetId])).get(targetId);
    if (!profile) return null;

    return { ...profile, distanceMeters: coarsenDistance(candidate.distanceMeters) };
  }

  /**
   * The caller's own coordinates, but only when discovery is possible at all:
   * Nearby Mode must be active and the last fix must still be fresh.
   */
  private async requireDiscoverableOrigin(userId: string): Promise<GeoCoordinate> {
    if (!(await this.presence.isActive(userId))) {
      throw new ConflictException('Nearby Mode is not active');
    }

    const location = await this.locations.get(userId);
    if (!location) {
      throw new ConflictException('No location on record — update your location first');
    }

    const maxAgeSeconds = this.config.get('nearby.locationMaxAgeSeconds', { infer: true });
    const ageSeconds = (Date.now() - Date.parse(location.updatedAt)) / 1000;
    if (ageSeconds > maxAgeSeconds) {
      throw new ConflictException('Your last location is too old — update your location first');
    }

    return { latitude: location.latitude, longitude: location.longitude };
  }
}
