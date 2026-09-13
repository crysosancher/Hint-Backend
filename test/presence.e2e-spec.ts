import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { RedisService } from '../src/infra/redis/redis.service';
import { NearbyStatus } from '../src/modules/presence/dto/nearby-session-response.dto';
import { PresenceController } from '../src/modules/presence/presence.controller';
import { PresenceService } from '../src/modules/presence/presence.service';

const ACCESS_SECRET = 'test-access-secret';
const SESSION_TTL_MINUTES = 30;

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

const CONFIG: Record<string, string | number> = {
  'nearby.sessionTtlMinutes': SESSION_TTL_MINUTES,
  'jwt.accessSecret': ACCESS_SECRET,
};

const configFake = {
  get: (key: string): string | number | undefined => CONFIG[key],
};

/**
 * End-to-end test for the Nearby Mode endpoints. Redis and config are replaced
 * with in-memory fakes so the suite exercises the real HTTP layer, routing,
 * global ValidationPipe, JwtAuthGuard and Swagger generation without Redis.
 */
describe('Presence (e2e)', () => {
  let app: INestApplication;

  const userId = new Types.ObjectId().toString();
  const accessToken = new JwtService().sign(
    { sub: userId, email: 'ada@example.com', type: 'access' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );
  const auth = (): string => `Bearer ${accessToken}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PresenceController],
      providers: [
        PresenceService,
        { provide: RedisService, useValue: new FakeRedis() },
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
      await request(app.getHttpServer()).get('/api/v1/nearby/status').expect(401);
    });
  });

  describe('POST /api/v1/nearby/activate', () => {
    it('activates Nearby Mode with the configured TTL (200)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/nearby/activate')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toMatchObject({
        userId,
        status: NearbyStatus.Active,
        ttlSeconds: SESSION_TTL_MINUTES * 60,
      });
      expect(typeof res.body.expiresAt).toBe('string');
    });

    it('reports the active session via GET status (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/nearby/status')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body.status).toBe(NearbyStatus.Active);
    });
  });

  describe('POST /api/v1/nearby/deactivate', () => {
    it('deactivates and clears the session (200)', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/nearby/activate')
        .set('Authorization', auth())
        .expect(200);

      const res = await request(app.getHttpServer())
        .post('/api/v1/nearby/deactivate')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toMatchObject({ userId, status: NearbyStatus.Inactive });

      const status = await request(app.getHttpServer())
        .get('/api/v1/nearby/status')
        .set('Authorization', auth())
        .expect(200);
      expect(status.body.status).toBe(NearbyStatus.Inactive);
    });
  });

  describe('OpenAPI document', () => {
    it('documents the nearby endpoints under the Presence tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/nearby/activate');
      expect(document.paths).toHaveProperty('/api/v1/nearby/deactivate');
      expect(document.paths).toHaveProperty('/api/v1/nearby/status');
      expect(document.tags?.map((tag) => tag.name)).toContain('Presence');
    });
  });
});
