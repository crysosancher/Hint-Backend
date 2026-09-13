import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { Gender } from '../src/common/enums/gender.enum';
import { Profession } from '../src/common/enums/profession.enum';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { DiscoveryController } from '../src/modules/discovery/discovery.controller';
import { DiscoveryService } from '../src/modules/discovery/discovery.service';
import { EligibleUsersController } from '../src/modules/discovery/users.controller';
import type { LocationResponseDto } from '../src/modules/location/dto/location-response.dto';
import { type NearbyLocation, LocationService } from '../src/modules/location/location.service';
import { PresenceService } from '../src/modules/presence/presence.service';
import type { SafeProfileDto } from '../src/modules/profiles/dto/safe-profile.dto';
import { ProfilesService } from '../src/modules/profiles/profiles.service';

const ACCESS_SECRET = 'test-access-secret';

class FakePresence {
  readonly active = new Set<string>();

  async isActive(userId: string): Promise<boolean> {
    return this.active.has(userId);
  }

  async filterActive(userIds: string[]): Promise<string[]> {
    return userIds.filter((userId) => this.active.has(userId));
  }
}

class FakeLocations {
  fixed: LocationResponseDto | null = null;
  candidates: NearbyLocation[] = [];

  async get(): Promise<LocationResponseDto | null> {
    return this.fixed;
  }

  async findNearby(): Promise<NearbyLocation[]> {
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

const CONFIG: Record<string, string | number> = {
  'nearby.radiusMeters': 250,
  'nearby.locationMaxAgeSeconds': 120,
  'jwt.accessSecret': ACCESS_SECRET,
};

const configFake = { get: (key: string): string | number | undefined => CONFIG[key] };

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 24,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: 'hello',
});

/**
 * End-to-end test for discovery. Redis, MongoDB (via LocationService) and the
 * profile store are replaced with in-memory fakes so the suite exercises the
 * real HTTP layer, routing, global ValidationPipe, JwtAuthGuard and Swagger
 * generation without any infrastructure.
 */
describe('Discovery (e2e)', () => {
  let app: INestApplication;
  let presence: FakePresence;
  let locations: FakeLocations;
  let profiles: FakeProfiles;

  const callerId = new Types.ObjectId().toString();
  const targetId = new Types.ObjectId().toString();

  const token = (userId: string): string =>
    new JwtService().sign(
      { sub: userId, email: `${userId.slice(0, 4)}@example.com`, type: 'access' },
      { secret: ACCESS_SECRET, expiresIn: 900 },
    );

  const auth = (userId: string = callerId): string => `Bearer ${token(userId)}`;

  const fix = (userId: string): LocationResponseDto => ({
    userId,
    latitude: 12.971599,
    longitude: 77.594566,
    accuracyMeters: 10,
    updatedAt: new Date().toISOString(),
  });

  beforeAll(async () => {
    presence = new FakePresence();
    locations = new FakeLocations();
    profiles = new FakeProfiles();

    const moduleRef = await Test.createTestingModule({
      controllers: [DiscoveryController, EligibleUsersController],
      providers: [
        DiscoveryService,
        { provide: PresenceService, useValue: presence },
        { provide: LocationService, useValue: locations },
        { provide: ProfilesService, useValue: profiles },
        { provide: ConfigService, useValue: configFake },
        JwtService,
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('rejects requests without a token (401)', async () => {
      await request(app.getHttpServer()).get('/api/v1/discovery/nearby').expect(401);
      await request(app.getHttpServer()).get(`/api/v1/users/${targetId}`).expect(401);
    });
  });

  describe('GET /api/v1/discovery/nearby', () => {
    beforeEach(() => {
      presence.active.clear();
      locations.candidates = [];
      locations.fixed = null;
    });

    it('rejects discovery while Nearby Mode is inactive (409)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/discovery/nearby')
        .set('Authorization', auth())
        .expect(409);
    });

    it('rejects discovery without a fresh location (409)', async () => {
      presence.active.add(callerId);

      await request(app.getHttpServer())
        .get('/api/v1/discovery/nearby')
        .set('Authorization', auth())
        .expect(409);
    });

    it('returns eligible users with coarse distances and no coordinates (200)', async () => {
      presence.active.add(callerId);
      presence.active.add(targetId);
      locations.fixed = fix(callerId);
      locations.candidates = [{ userId: targetId, distanceMeters: 120 }];
      profiles.profiles.set(targetId, profileFor(targetId, 'Maya'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/discovery/nearby')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0]).toMatchObject({
        userId: targetId,
        name: 'Maya',
        distanceMeters: 100,
      });
      expect(res.body[0]).not.toHaveProperty('latitude');
      expect(res.body[0]).not.toHaveProperty('longitude');
    });
  });

  describe('GET /api/v1/users/:userId', () => {
    beforeEach(() => {
      presence.active.clear();
      locations.candidates = [];
      locations.fixed = null;
    });

    it('returns 404 when the user is not discoverable', async () => {
      presence.active.add(callerId);
      locations.fixed = fix(callerId);

      await request(app.getHttpServer())
        .get(`/api/v1/users/${targetId}`)
        .set('Authorization', auth())
        .expect(404);
    });

    it('returns the eligible profile (200)', async () => {
      presence.active.add(callerId);
      presence.active.add(targetId);
      locations.fixed = fix(callerId);
      locations.candidates = [{ userId: targetId, distanceMeters: 60 }];
      profiles.profiles.set(targetId, profileFor(targetId, 'Maya'));

      const res = await request(app.getHttpServer())
        .get(`/api/v1/users/${targetId}`)
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toMatchObject({ userId: targetId, name: 'Maya', distanceMeters: 50 });
    });
  });

  describe('OpenAPI document', () => {
    it('documents discovery under the Discovery tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/discovery/nearby');
      expect(document.paths).toHaveProperty('/api/v1/users/{userId}');
      expect(document.tags?.map((tag) => tag.name)).toContain('Discovery');
    });
  });
});
