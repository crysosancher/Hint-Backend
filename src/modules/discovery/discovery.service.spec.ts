import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Types } from 'mongoose';
import { Gender } from '../../common/enums/gender.enum';
import { Profession } from '../../common/enums/profession.enum';
import type { AppConfiguration } from '../../config/configuration';
import type { LocationResponseDto } from '../location/dto/location-response.dto';
import { type NearbyLocation, LocationService } from '../location/location.service';
import { PresenceService } from '../presence/presence.service';
import type { SafeProfileDto } from '../profiles/dto/safe-profile.dto';
import { ProfilesService } from '../profiles/profiles.service';
import { DiscoveryService } from './discovery.service';

/** In-memory stand-in for Redis-backed presence. */
class FakePresence {
  readonly active = new Set<string>();

  async isActive(userId: string): Promise<boolean> {
    return this.active.has(userId);
  }

  async filterActive(userIds: string[]): Promise<string[]> {
    return userIds.filter((userId) => this.active.has(userId));
  }
}

/** Canned geospatial results; the real `$geoNear` shape is what matters here. */
class FakeLocations {
  fixed: LocationResponseDto | null = null;
  candidates: NearbyLocation[] = [];
  lastQuery: { radiusMeters: number; maxAgeSeconds: number; excludeUserId: string } | null = null;

  async get(): Promise<LocationResponseDto | null> {
    return this.fixed;
  }

  async findNearby(
    _point: unknown,
    options: { radiusMeters: number; maxAgeSeconds: number; excludeUserId: string },
  ): Promise<NearbyLocation[]> {
    this.lastQuery = options;
    return this.candidates;
  }
}

class FakeProfiles {
  readonly profiles = new Map<string, SafeProfileDto>();

  async findManySafeProfiles(userIds: string[]): Promise<Map<string, SafeProfileDto>> {
    const found = new Map<string, SafeProfileDto>();
    for (const userId of userIds) {
      const profile = this.profiles.get(userId);
      if (profile) found.set(userId, profile);
    }
    return found;
  }
}

const CONFIG: Record<string, number> = {
  'nearby.radiusMeters': 250,
  'nearby.locationMaxAgeSeconds': 120,
};

const configFake = { get: (key: string): number | undefined => CONFIG[key] };

const fix = (userId: string, overrides: Partial<LocationResponseDto> = {}): LocationResponseDto => ({
  userId,
  latitude: 12.971599,
  longitude: 77.594566,
  accuracyMeters: 10,
  updatedAt: new Date().toISOString(),
  ...overrides,
});

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 25,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: '',
});

describe('DiscoveryService', () => {
  const callerId = new Types.ObjectId().toString();
  const nearId = new Types.ObjectId().toString();
  const farId = new Types.ObjectId().toString();

  let presence: FakePresence;
  let locations: FakeLocations;
  let profiles: FakeProfiles;
  let service: DiscoveryService;

  beforeEach(() => {
    presence = new FakePresence();
    locations = new FakeLocations();
    profiles = new FakeProfiles();

    service = new DiscoveryService(
      configFake as unknown as ConfigService<AppConfiguration, true>,
      presence as unknown as PresenceService,
      locations as unknown as LocationService,
      profiles as unknown as ProfilesService,
    );

    // The happy-path precondition: caller is discoverable with a fresh fix.
    presence.active.add(callerId);
    locations.fixed = fix(callerId);
  });

  it('returns nearby users nearest first, with coarse distances', async () => {
    locations.candidates = [
      { userId: farId, distanceMeters: 240 },
      { userId: nearId, distanceMeters: 12 },
    ];
    presence.active.add(nearId);
    presence.active.add(farId);
    profiles.profiles.set(nearId, profileFor(nearId, 'Near'));
    profiles.profiles.set(farId, profileFor(farId, 'Far'));

    const result = await service.findNearby(callerId);

    expect(result.map((entry) => entry.userId)).toEqual([nearId, farId]);
    // 12 m -> 0 m bucket, 240 m -> 200 m bucket: never the exact distance.
    expect(result.map((entry) => entry.distanceMeters)).toEqual([0, 200]);
  });

  it('never leaks exact coordinates to another user', async () => {
    locations.candidates = [{ userId: nearId, distanceMeters: 12 }];
    presence.active.add(nearId);
    profiles.profiles.set(nearId, profileFor(nearId, 'Near'));

    const [entry] = await service.findNearby(callerId);

    expect(entry).not.toHaveProperty('latitude');
    expect(entry).not.toHaveProperty('longitude');
    expect(entry).not.toHaveProperty('location');
  });

  it('excludes candidates who are not in Nearby Mode', async () => {
    locations.candidates = [{ userId: nearId, distanceMeters: 30 }];
    profiles.profiles.set(nearId, profileFor(nearId, 'Near'));

    await expect(service.findNearby(callerId)).resolves.toEqual([]);
  });

  it('excludes candidates without a profile', async () => {
    locations.candidates = [{ userId: nearId, distanceMeters: 30 }];
    presence.active.add(nearId);

    await expect(service.findNearby(callerId)).resolves.toEqual([]);
  });

  it('applies the configured radius and freshness, and excludes the caller', async () => {
    await service.findNearby(callerId);

    expect(locations.lastQuery).toEqual({
      radiusMeters: 250,
      maxAgeSeconds: 120,
      excludeUserId: callerId,
    });
  });

  it('rejects discovery while Nearby Mode is inactive', async () => {
    presence.active.clear();

    await expect(service.findNearby(callerId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects discovery without a stored location', async () => {
    locations.fixed = null;

    await expect(service.findNearby(callerId)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects discovery when the stored fix is stale', async () => {
    locations.fixed = fix(callerId, {
      updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });

    await expect(service.findNearby(callerId)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('findEligibleProfile', () => {
    const targetId = new Types.ObjectId().toString();

    const makeEligibleTarget = (): void => {
      presence.active.add(targetId);
      locations.candidates = [{ userId: targetId, distanceMeters: 120 }];
      profiles.profiles.set(targetId, profileFor(targetId, 'Target'));
    };

    it('returns a single eligible profile with a coarse distance', async () => {
      makeEligibleTarget();

      await expect(service.findEligibleProfile(callerId, targetId)).resolves.toMatchObject({
        userId: targetId,
        name: 'Target',
        distanceMeters: 100,
      });
    });

    it('returns null when the target is outside the radius', async () => {
      presence.active.add(targetId);
      profiles.profiles.set(targetId, profileFor(targetId, 'Target'));
      locations.candidates = [];

      await expect(service.findEligibleProfile(callerId, targetId)).resolves.toBeNull();
    });

    it('returns null when the target is not in Nearby Mode', async () => {
      locations.candidates = [{ userId: targetId, distanceMeters: 120 }];
      profiles.profiles.set(targetId, profileFor(targetId, 'Target'));

      await expect(service.findEligibleProfile(callerId, targetId)).resolves.toBeNull();
    });

    it('returns null when the target has no profile', async () => {
      presence.active.add(targetId);
      locations.candidates = [{ userId: targetId, distanceMeters: 120 }];

      await expect(service.findEligibleProfile(callerId, targetId)).resolves.toBeNull();
    });

    it('returns null when the caller asks for themselves', async () => {
      makeEligibleTarget();

      await expect(service.findEligibleProfile(callerId, callerId)).resolves.toBeNull();
    });

    it('still enforces the caller\u2019s own discoverability', async () => {
      makeEligibleTarget();
      presence.active.delete(callerId);

      await expect(service.findEligibleProfile(callerId, targetId)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });
  });
});
