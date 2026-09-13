import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { Gender } from '../src/common/enums/gender.enum';
import { InterestStatus } from '../src/common/enums/interest-status.enum';
import { MatchStatus } from '../src/common/enums/match-status.enum';
import { Profession } from '../src/common/enums/profession.enum';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { InterestsController } from '../src/modules/interests/interests.controller';
import { InterestsService } from '../src/modules/interests/interests.service';
import { Interest } from '../src/modules/interests/interest.schema';
import type { LocationResponseDto } from '../src/modules/location/dto/location-response.dto';
import { LocationService } from '../src/modules/location/location.service';
import type { MatchResponseDto } from '../src/modules/matches/dto/match-response.dto';
import { MatchService } from '../src/modules/matches/matches.service';
import { PresenceService } from '../src/modules/presence/presence.service';
import type { SafeProfileDto } from '../src/modules/profiles/dto/safe-profile.dto';
import { ProfilesService } from '../src/modules/profiles/profiles.service';

const ACCESS_SECRET = 'test-access-secret';

type StoredInterest = {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  status: InterestStatus;
  expiresAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const asId = (value: unknown): string => String(value);

/** In-memory stand-in for the interest model (see the unit spec for details). */
class FakeInterestModel {
  readonly docs = new Map<string, StoredInterest>();

  async create(input: {
    senderId: string;
    receiverId: string;
    status: InterestStatus;
    expiresAt: Date;
  }): Promise<StoredInterest> {
    const now = new Date();
    const doc: StoredInterest = {
      _id: new Types.ObjectId(),
      senderId: new Types.ObjectId(input.senderId),
      receiverId: new Types.ObjectId(input.receiverId),
      status: input.status,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    };
    this.docs.set(doc._id.toString(), doc);
    return this.hydrate(doc);
  }

  findOne(filter: Record<string, unknown>) {
    const [doc] = this.matching(filter);
    return { exec: async (): Promise<StoredInterest | null> => (doc ? this.hydrate(doc) : null) };
  }

  findById(id: string) {
    return {
      exec: async (): Promise<StoredInterest | null> => {
        const doc = this.docs.get(id);
        return doc ? this.hydrate(doc) : null;
      },
    };
  }

  find(filter: Record<string, unknown>) {
    const results = this.matching(filter);
    return {
      sort: () => ({ exec: async (): Promise<StoredInterest[]> => results.map((d) => this.hydrate(d)) }),
    };
  }

  private matching(filter: Record<string, unknown>): StoredInterest[] {
    return [...this.docs.values()].filter((doc) => this.matches(doc, filter));
  }

  private matches(doc: StoredInterest, filter: Record<string, unknown>): boolean {
    if (filter.status !== undefined && doc.status !== filter.status) return false;

    const expiresAt = filter.expiresAt as { $gt?: Date } | undefined;
    if (expiresAt?.$gt && doc.expiresAt.getTime() <= expiresAt.$gt.getTime()) return false;

    if (filter.senderId !== undefined && asId(doc.senderId) !== asId(filter.senderId)) return false;
    if (filter.receiverId !== undefined && asId(doc.receiverId) !== asId(filter.receiverId)) {
      return false;
    }

    const alternatives = filter.$or as Array<Record<string, unknown>> | undefined;
    if (alternatives && !alternatives.some((clause) => this.matches(doc, clause))) return false;

    return true;
  }

  private hydrate(doc: StoredInterest): StoredInterest {
    return Object.assign(doc, {
      save: async (): Promise<StoredInterest> => {
        this.docs.set(doc._id.toString(), doc);
        return doc;
      },
    });
  }
}

class FakePresence {
  readonly active = new Set<string>();

  async isActive(userId: string): Promise<boolean> {
    return this.active.has(userId);
  }
}

class FakeLocations {
  readonly fixes = new Map<string, LocationResponseDto>();

  async get(userId: string): Promise<LocationResponseDto | null> {
    return this.fixes.get(userId) ?? null;
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

class FakeMatches {
  async createFromAcceptedInterest(input: {
    interestId: string;
    senderId: string;
    receiverId: string;
  }): Promise<MatchResponseDto> {
    return {
      id: new Types.ObjectId().toString(),
      status: MatchStatus.Active,
      interestId: input.interestId,
      matchedAt: new Date().toISOString(),
    };
  }
}

const CONFIG: Record<string, string | number> = {
  'nearby.radiusMeters': 250,
  'nearby.locationMaxAgeSeconds': 120,
  'interest.ttlDays': 7,
  'jwt.accessSecret': ACCESS_SECRET,
};

const configFake = { get: (key: string): string | number | undefined => CONFIG[key] };

// ~222 m apart: inside the radius. ~334 m: outside it.
const SENDER_POINT = { latitude: 0, longitude: 0 };
const RECEIVER_POINT = { latitude: 0, longitude: 0.002 };
const FAR_POINT = { latitude: 0, longitude: 0.003 };

const fix = (
  userId: string,
  point: { latitude: number; longitude: number },
): LocationResponseDto => ({
  userId,
  latitude: point.latitude,
  longitude: point.longitude,
  accuracyMeters: 10,
  updatedAt: new Date().toISOString(),
});

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 25,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: '',
});

/**
 * End-to-end test for the interest lifecycle. Mongo, Redis and the profile store
 * are faked so the suite exercises the real HTTP layer, routing, global
 * ValidationPipe, JwtAuthGuard and Swagger generation without infrastructure.
 */
describe('Interests (e2e)', () => {
  let app: INestApplication;
  let model: FakeInterestModel;
  let presence: FakePresence;
  let locations: FakeLocations;
  let profiles: FakeProfiles;

  const senderId = new Types.ObjectId().toString();
  const receiverId = new Types.ObjectId().toString();

  const auth = (userId: string): string =>
    `Bearer ${new JwtService().sign(
      { sub: userId, email: `${userId.slice(0, 4)}@example.com`, type: 'access' },
      { secret: ACCESS_SECRET, expiresIn: 900 },
    )}`;

  const makeDiscoverable = (): void => {
    presence.active.add(senderId);
    presence.active.add(receiverId);
    locations.fixes.set(senderId, fix(senderId, SENDER_POINT));
    locations.fixes.set(receiverId, fix(receiverId, RECEIVER_POINT));
    profiles.profiles.set(senderId, profileFor(senderId, 'Sender'));
    profiles.profiles.set(receiverId, profileFor(receiverId, 'Receiver'));
  };

  const sendInterest = async (): Promise<string> => {
    const res = await request(app.getHttpServer())
      .post(`/api/v1/interests/${receiverId}`)
      .set('Authorization', auth(senderId))
      .expect(200);

    return res.body.id as string;
  };

  beforeAll(async () => {
    model = new FakeInterestModel();
    presence = new FakePresence();
    locations = new FakeLocations();
    profiles = new FakeProfiles();

    const moduleRef = await Test.createTestingModule({
      controllers: [InterestsController],
      providers: [
        InterestsService,
        { provide: getModelToken(Interest.name), useValue: model },
        { provide: PresenceService, useValue: presence },
        { provide: LocationService, useValue: locations },
        { provide: ProfilesService, useValue: profiles },
        { provide: MatchService, useValue: new FakeMatches() },
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

  beforeEach(() => {
    model.docs.clear();
    presence.active.clear();
    locations.fixes.clear();
    profiles.profiles.clear();
    makeDiscoverable();
  });

  describe('authentication', () => {
    it('rejects requests without a token (401)', async () => {
      await request(app.getHttpServer()).get('/api/v1/interests/incoming').expect(401);
      await request(app.getHttpServer()).post(`/api/v1/interests/${receiverId}`).expect(401);
    });
  });

  describe('POST /api/v1/interests/:userId', () => {
    it('sends an interest to a mutually discoverable user (200)', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/interests/${receiverId}`)
        .set('Authorization', auth(senderId))
        .expect(200);

      expect(res.body).toMatchObject({ senderId, receiverId, status: InterestStatus.Sent });
      expect(typeof res.body.expiresAt).toBe('string');
    });

    it('rejects an interest sent to yourself (400)', async () => {
      await request(app.getHttpServer())
        .post(`/api/v1/interests/${senderId}`)
        .set('Authorization', auth(senderId))
        .expect(400);
    });

    it('rejects a target outside the 250 m radius (409)', async () => {
      locations.fixes.set(receiverId, fix(receiverId, FAR_POINT));

      await request(app.getHttpServer())
        .post(`/api/v1/interests/${receiverId}`)
        .set('Authorization', auth(senderId))
        .expect(409);
    });

    it('rejects a target that is not in Nearby Mode (409)', async () => {
      presence.active.delete(receiverId);

      await request(app.getHttpServer())
        .post(`/api/v1/interests/${receiverId}`)
        .set('Authorization', auth(senderId))
        .expect(409);
    });

    it('rejects a duplicate pending interest (409)', async () => {
      await sendInterest();

      await request(app.getHttpServer())
        .post(`/api/v1/interests/${receiverId}`)
        .set('Authorization', auth(senderId))
        .expect(409);
    });
  });

  describe('inbox and outbox', () => {
    it('lists the received interest with the sender profile (200)', async () => {
      await sendInterest();

      const res = await request(app.getHttpServer())
        .get('/api/v1/interests/incoming')
        .set('Authorization', auth(receiverId))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].interest).toMatchObject({ status: InterestStatus.Sent });
      expect(res.body[0].user).toMatchObject({ userId: senderId, name: 'Sender' });
    });

    it('lists the sent interest with the receiver profile (200)', async () => {
      await sendInterest();

      const res = await request(app.getHttpServer())
        .get('/api/v1/interests/outgoing')
        .set('Authorization', auth(senderId))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].user).toMatchObject({ userId: receiverId, name: 'Receiver' });
    });
  });

  describe('POST /api/v1/interests/:interestId/accept', () => {
    it('accepts an interest and returns the new match (200)', async () => {
      const interestId = await sendInterest();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/interests/${interestId}/accept`)
        .set('Authorization', auth(receiverId))
        .expect(200);

      expect(res.body.interest).toMatchObject({ id: interestId, status: InterestStatus.Accepted });
      expect(res.body.match).toMatchObject({ status: MatchStatus.Active, interestId });
    });

    it('does not let the sender accept their own interest (404)', async () => {
      const interestId = await sendInterest();

      await request(app.getHttpServer())
        .post(`/api/v1/interests/${interestId}/accept`)
        .set('Authorization', auth(senderId))
        .expect(404);
    });
  });

  describe('POST /api/v1/interests/:interestId/ignore', () => {
    it('ignores an interest (200) and removes it from the inbox', async () => {
      const interestId = await sendInterest();

      const res = await request(app.getHttpServer())
        .post(`/api/v1/interests/${interestId}/ignore`)
        .set('Authorization', auth(receiverId))
        .expect(200);

      expect(res.body).toMatchObject({ id: interestId, status: InterestStatus.Ignored });

      const inbox = await request(app.getHttpServer())
        .get('/api/v1/interests/incoming')
        .set('Authorization', auth(receiverId))
        .expect(200);

      expect(inbox.body).toEqual([]);
    });
  });

  describe('OpenAPI document', () => {
    it('documents the interest endpoints under the Interests tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/interests/{userId}');
      expect(document.paths).toHaveProperty('/api/v1/interests/incoming');
      expect(document.paths).toHaveProperty('/api/v1/interests/outgoing');
      expect(document.paths).toHaveProperty('/api/v1/interests/{interestId}/accept');
      expect(document.paths).toHaveProperty('/api/v1/interests/{interestId}/ignore');
      expect(document.tags?.map((tag) => tag.name)).toContain('Interests');
    });
  });
});
