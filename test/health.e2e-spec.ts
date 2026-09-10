import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { RedisService } from '../src/infra/redis/redis.service';
import { HealthController } from '../src/modules/health/health.controller';

/**
 * E2E test for the health endpoints.
 *
 * The Mongo connection and Redis service are replaced with fakes so the suite
 * runs without external infrastructure while still exercising the real HTTP
 * layer, routing and controller logic through supertest.
 */
describe('Health (e2e)', () => {
  let app: INestApplication;

  const mongoFake = {
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
  };

  const redisFake = {
    ping: async () => true,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: mongoFake },
        { provide: RedisService, useValue: redisFake },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health → 200 liveness', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptime).toBe('number');
    expect(typeof res.body.timestamp).toBe('string');
  });

  it('GET /health/ready → 200 when Mongo and Redis answer', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready').expect(200);

    expect(res.body).toEqual({
      status: 'ok',
      checks: { mongodb: true, redis: true },
    });
  });

  it('GET /health/ready → degraded when Redis is down', async () => {
    const failingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: mongoFake },
        {
          provide: RedisService,
          useValue: {
            ping: async () => {
              throw new Error('redis down');
            },
          },
        },
      ],
    }).compile();

    const failingApp = failingModule.createNestApplication();
    await failingApp.init();

    const res = await request(failingApp.getHttpServer()).get('/health/ready').expect(200);
    expect(res.body).toEqual({
      status: 'degraded',
      checks: { mongodb: true, redis: false },
    });

    await failingApp.close();
  });
});
