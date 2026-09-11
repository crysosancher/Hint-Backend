import { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { createOpenApiDocument, setupSwagger } from '../src/config/swagger.setup';
import { RedisService } from '../src/infra/redis/redis.service';
import { HealthController } from '../src/modules/health/health.controller';

/**
 * Verifies the generated OpenAPI document and that the Swagger UI + JSON
 * document are actually served. Uses fakes for Mongo/Redis so no infrastructure
 * is required.
 */
describe('Swagger / OpenAPI (e2e)', () => {
  let app: INestApplication;

  const mongoFake = {
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: getConnectionToken(), useValue: mongoFake },
        { provide: RedisService, useValue: { ping: async () => true } },
      ],
    }).compile();

    app = moduleRef.createNestApplication();
    setupSwagger(app, 'docs');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('serves the raw OpenAPI JSON document at /docs/json', async () => {
    const res = await request(app.getHttpServer()).get('/docs/json').expect(200);

    expect(res.body.openapi).toMatch(/^3\./);
    expect(res.body.info.title).toBe('Hint Backend API');
    expect(res.body.paths).toHaveProperty('/health');
    expect(res.body.paths).toHaveProperty('/health/ready');
  });

  it('serves the Swagger UI at /docs', async () => {
    await request(app.getHttpServer()).get('/docs').expect(200);
  });

  it('registers the JWT bearer security scheme', () => {
    const document = createOpenApiDocument(app);

    expect(document.components?.securitySchemes?.['access-token']).toMatchObject({
      type: 'http',
      scheme: 'bearer',
      bearerFormat: 'JWT',
    });
  });

  it('describes the liveness response schema', () => {
    const document = createOpenApiDocument(app);
    const liveness = document.paths?.['/health']?.get?.responses?.['200'];

    expect(liveness).toBeDefined();
    expect(JSON.stringify(liveness)).toContain('LivenessResponseDto');
  });
});
