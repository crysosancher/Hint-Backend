import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { PasswordService } from '../src/common/password/password.service';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { RedisService } from '../src/infra/redis/redis.service';
import { AuthController } from '../src/modules/auth/auth.controller';
import { AuthService } from '../src/modules/auth/auth.service';
import { UserDocument, UserStatus } from '../src/modules/users/user.schema';
import { UsersService } from '../src/modules/users/users.service';

/**
 * End-to-end test for the auth endpoints.
 *
 * Users and Redis are replaced with in-memory fakes so the suite exercises the
 * real HTTP layer, routing, global ValidationPipe and Swagger generation without
 * requiring infrastructure — mirroring the existing health/swagger suites.
 */
const userStore = new Map<string, UserDocument>();

const normalizeEmail = (email: string): string => email.trim().toLowerCase();

const usersFake = {
  normalizeEmail,
  existsByEmail: async (email: string): Promise<boolean> => userStore.has(normalizeEmail(email)),
  create: async (input: { email: string; passwordHash: string }): Promise<UserDocument> => {
    const email = normalizeEmail(input.email);
    const user = {
      _id: new Types.ObjectId(),
      email,
      passwordHash: input.passwordHash,
      status: UserStatus.Active,
      createdAt: new Date(),
    } as unknown as UserDocument;

    userStore.set(email, user);
    return user;
  },
  findByEmail: async (email: string): Promise<UserDocument | null> =>
    userStore.get(normalizeEmail(email)) ?? null,
  findById: async (id: string): Promise<UserDocument | null> => {
    for (const user of userStore.values()) if (user._id.toString() === id) return user;
    return null;
  },
};

const redisStore = new Map<string, string>();

const redisFake = {
  key: (...parts: (string | number)[]): string => ['hint', ...parts].join(':'),
  del: async (...keys: string[]): Promise<number> => {
    let removed = 0;
    for (const key of keys) if (redisStore.delete(key)) removed += 1;
    return removed;
  },
  client: {
    get: async (key: string): Promise<string | null> => redisStore.get(key) ?? null,
    set: async (key: string, value: string): Promise<'OK'> => {
      redisStore.set(key, value);
      return 'OK';
    },
  },
};

const CONFIG: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessTtl': '15m',
  'jwt.refreshSecret': 'test-refresh-secret',
  'jwt.refreshTtl': '30d',
};

const configFake = { get: (key: string): string | undefined => CONFIG[key] };

const credentials = {
  email: 'ada@example.com',
  password: 'Sunshine123',
  confirmPassword: 'Sunshine123',
};

describe('Auth (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        PasswordService,
        JwtService,
        { provide: UsersService, useValue: usersFake },
        { provide: RedisService, useValue: redisFake },
        { provide: ConfigService, useValue: configFake },
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

  beforeEach(() => {
    userStore.clear();
    redisStore.clear();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /api/v1/auth/register', () => {
    it('creates an account and returns a token pair', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials })
        .expect(201);

      expect(res.body.user).toMatchObject({ email: 'ada@example.com', status: 'active' });
      expect(res.body.user).not.toHaveProperty('passwordHash');
      expect(typeof res.body.accessToken).toBe('string');
      expect(typeof res.body.refreshToken).toBe('string');
    });

    it('rejects a duplicate email with 409', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials })
        .expect(409);
    });

    it('rejects mismatched passwords with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, confirmPassword: 'Different123' })
        .expect(400);
    });

    it('rejects an invalid email with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, email: 'not-an-email' })
        .expect(400);
    });

    it('rejects a weak password with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, password: 'short', confirmPassword: 'short' })
        .expect(400);
    });

    it('rejects unknown fields with 400', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials, role: 'admin' })
        .expect(400);
    });
  });

  describe('POST /api/v1/auth/login', () => {
    beforeEach(async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials })
        .expect(201);
    });

    it('authenticates with correct credentials', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'Ada@Example.com', password: credentials.password })
        .expect(200);

      expect(res.body.user.email).toBe('ada@example.com');
      expect(typeof res.body.accessToken).toBe('string');
    });

    it('rejects a wrong password with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: credentials.email, password: 'Nope12345' })
        .expect(401);
    });

    it('rejects an unknown email with 401 and a generic message', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email: 'nobody@example.com', password: credentials.password })
        .expect(401);

      expect(res.body.message).toBe('Invalid email or password');
    });
  });

  describe('POST /api/v1/auth/refresh', () => {
    it('rotates the refresh token and rejects replay', async () => {
      const registered = await request(app.getHttpServer())
        .post('/api/v1/auth/register')
        .send({ ...credentials })
        .expect(201);

      const rotated = await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: registered.body.refreshToken })
        .expect(200);

      expect(rotated.body.refreshToken).not.toBe(registered.body.refreshToken);

      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: registered.body.refreshToken })
        .expect(401);
    });

    it('rejects a malformed token with 401', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'not-a-jwt' })
        .expect(401);
    });
  });

  describe('OpenAPI document', () => {
    it('documents the auth endpoints under the Auth tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/auth/register');
      expect(document.paths).toHaveProperty('/api/v1/auth/login');
      expect(document.paths).toHaveProperty('/api/v1/auth/refresh');
      expect(document.tags?.map((tag) => tag.name)).toContain('Auth');
    });
  });
});
