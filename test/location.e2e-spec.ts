import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { LocationController } from '../src/modules/location/location.controller';
import { Location } from '../src/modules/location/location.schema';
import { LocationService } from '../src/modules/location/location.service';
import { PresenceService } from '../src/modules/presence/presence.service';

const ACCESS_SECRET = 'test-access-secret';
const MAX_ACCURACY_METERS = 100;

type StoredLocation = {
  _id: Types.ObjectId;
  userId: string;
  location: { type: 'Point'; coordinates: [number, number] };
  accuracyMeters: number;
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory stand-in for the Mongoose location model, so the suite needs no Mongo. */
class FakeLocationModel {
  readonly docs = new Map<string, StoredLocation>();

  findOne(filter: { userId: string }) {
    const doc = this.docs.get(filter.userId) ?? null;
    return { exec: async (): Promise<StoredLocation | null> => (doc ? { ...doc } : null) };
  }

  findOneAndUpdate(
    filter: { userId: string },
    update: { $set: { location: StoredLocation['location']; accuracyMeters: number } },
  ) {
    const existing = this.docs.get(filter.userId);
    const now = new Date();
    const doc: StoredLocation = {
      _id: existing?._id ?? new Types.ObjectId(),
      userId: filter.userId,
      location: update.$set.location,
      accuracyMeters: update.$set.accuracyMeters,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.docs.set(filter.userId, doc);
    return { exec: async (): Promise<StoredLocation> => ({ ...doc }) };
  }
}

/** Toggleable stand-in for PresenceService. */
class FakePresence {
  active = true;

  async isActive(): Promise<boolean> {
    return this.active;
  }
}

const CONFIG: Record<string, string | number> = {
  'nearby.locationMaxAccuracyMeters': MAX_ACCURACY_METERS,
  'jwt.accessSecret': ACCESS_SECRET,
};

const configFake = {
  get: (key: string): string | number | undefined => CONFIG[key],
};

/**
 * End-to-end test for location ingestion. Mongo and presence are replaced with
 * in-memory fakes so the suite exercises the real HTTP layer, routing, global
 * ValidationPipe, JwtAuthGuard and Swagger generation without infrastructure.
 */
describe('Location (e2e)', () => {
  let app: INestApplication;
  let presence: FakePresence;

  const userId = new Types.ObjectId().toString();
  const accessToken = new JwtService().sign(
    { sub: userId, email: 'ada@example.com', type: 'access' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );
  const auth = (): string => `Bearer ${accessToken}`;

  // A second identity that never ingests a location, for the 404 case.
  const otherUserId = new Types.ObjectId().toString();
  const otherToken = new JwtService().sign(
    { sub: otherUserId, email: 'bob@example.com', type: 'access' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );

  const fix = { latitude: 12.971599, longitude: 77.594566, accuracyMeters: 12.5 };

  beforeAll(async () => {
    presence = new FakePresence();

    const moduleRef = await Test.createTestingModule({
      controllers: [LocationController],
      providers: [
        LocationService,
        { provide: getModelToken(Location.name), useValue: new FakeLocationModel() },
        { provide: PresenceService, useValue: presence },
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
    it('rejects a request without a token (401)', async () => {
      await request(app.getHttpServer()).post('/api/v1/location').send(fix).expect(401);
    });
  });

  describe('POST /api/v1/location', () => {
    beforeEach(() => {
      presence.active = true;
    });

    it('rejects a fix while Nearby Mode is inactive (409)', async () => {
      presence.active = false;

      await request(app.getHttpServer())
        .post('/api/v1/location')
        .set('Authorization', auth())
        .send(fix)
        .expect(409);
    });

    it('rejects a fix whose accuracy is too poor (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/location')
        .set('Authorization', auth())
        .send({ ...fix, accuracyMeters: MAX_ACCURACY_METERS + 50 })
        .expect(400);
    });

    it('rejects out-of-range coordinates (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/location')
        .set('Authorization', auth())
        .send({ ...fix, latitude: 91 })
        .expect(400);
    });

    it('rejects unknown fields (400)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/location')
        .set('Authorization', auth())
        .send({ ...fix, distanceMeters: 10 })
        .expect(400);
    });

    it('ingests a valid fix and echoes it (200)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/location')
        .set('Authorization', auth())
        .send(fix)
        .expect(200);

      expect(res.body).toMatchObject({ userId, ...fix });
      expect(typeof res.body.updatedAt).toBe('string');
    });
  });

  describe('GET /api/v1/location', () => {
    it('returns 404 when the caller has no location yet', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/location')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('returns the stored location (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/location')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toMatchObject({ userId, ...fix });
    });
  });

  describe('OpenAPI document', () => {
    it('documents the location endpoint under the Location tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/location');
      expect(document.tags?.map((tag) => tag.name)).toContain('Location');
    });
  });
});
