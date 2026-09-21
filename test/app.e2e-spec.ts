import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { AppModule } from '../src/app.module';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { REDIS_CLIENT } from '../src/infra/redis/redis.constants';
import { DiscoveryService } from '../src/modules/discovery/discovery.service';
import { InterestsService } from '../src/modules/interests/interests.service';
import { LocationService } from '../src/modules/location/location.service';
import { MatchService } from '../src/modules/matches/matches.service';
import { PresenceService } from '../src/modules/presence/presence.service';
import { ProfilesService } from '../src/modules/profiles/profiles.service';
import {
  INTEREST_EXPIRY_QUEUE,
  LOCATION_CLEANUP_QUEUE,
  PRESENCE_EXPIRY_QUEUE,
} from '../src/queues/queue.constants';

/**
 * Boots the **real** `AppModule` — the same graph `main.ts` starts — with the
 * Mongo connection and Redis client swapped for fakes.
 *
 * Every other suite compiles a single feature module in isolation, so this is
 * the only place that proves the whole dependency graph is wired (no missing
 * exports, no circular imports between the feature modules) and that the new
 * routes really are registered on the application.
 */
describe('App module (e2e)', () => {
  let app: INestApplication;

  const connectionFake = {
    models: {} as Record<string, unknown>,
    model: (name: string): { modelName: string } => ({ modelName: name }),
    db: { admin: () => ({ ping: async () => ({ ok: 1 }) }) },
    readyState: 1,
    asPromise: async (): Promise<unknown> => connectionFake,
    close: async (): Promise<void> => undefined,
  };

  const redisFake = {
    status: 'ready',
    on: (): unknown => redisFake,
  };

  // Replaces the BullMQ producers (and their Redis connections) for the API
  // graph; the queue consumers only ever run in the worker process.
  const queueFake = {
    add: async (): Promise<{ id?: string }> => ({}),
    remove: async (): Promise<number> => 0,
    upsertJobScheduler: async (): Promise<unknown> => ({}),
    close: async (): Promise<void> => undefined,
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getConnectionToken())
      .useValue(connectionFake)
      .overrideProvider(REDIS_CLIENT)
      .useValue(redisFake)
      .overrideProvider(INTEREST_EXPIRY_QUEUE)
      .useValue(queueFake)
      .overrideProvider(PRESENCE_EXPIRY_QUEUE)
      .useValue(queueFake)
      .overrideProvider(LOCATION_CLEANUP_QUEUE)
      .useValue(queueFake)
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1', {
      exclude: [
        { path: 'health', method: RequestMethod.GET },
        { path: 'health/ready', method: RequestMethod.GET },
      ],
    });
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('resolves the discovery, interest and match services', () => {
    expect(app.get(DiscoveryService)).toBeInstanceOf(DiscoveryService);
    expect(app.get(InterestsService)).toBeInstanceOf(InterestsService);
    expect(app.get(MatchService)).toBeInstanceOf(MatchService);
    expect(app.get(LocationService)).toBeInstanceOf(LocationService);
    expect(app.get(PresenceService)).toBeInstanceOf(PresenceService);
    expect(app.get(ProfilesService)).toBeInstanceOf(ProfilesService);
  });

  it('registers every Phase 3 route in the OpenAPI document', () => {
    const document = createOpenApiDocument(app);
    const paths = Object.keys(document.paths ?? {});

    expect(paths).toEqual(
      expect.arrayContaining([
        '/api/v1/discovery/nearby',
        '/api/v1/users/{userId}',
        '/api/v1/interests/{userId}',
        '/api/v1/interests/incoming',
        '/api/v1/interests/outgoing',
        '/api/v1/interests/{interestId}/accept',
        '/api/v1/interests/{interestId}/ignore',
        '/api/v1/matches',
      ]),
    );
    expect(document.tags?.map((tag) => tag.name)).toEqual(
      expect.arrayContaining(['Discovery', 'Interests', 'Matches']),
    );
  });
});
