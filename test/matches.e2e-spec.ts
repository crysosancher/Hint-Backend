import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { Gender } from '../src/common/enums/gender.enum';
import { MatchStatus } from '../src/common/enums/match-status.enum';
import { Profession } from '../src/common/enums/profession.enum';
import { createOpenApiDocument } from '../src/config/swagger.setup';
import { Match } from '../src/modules/matches/match.schema';
import { MatchesController } from '../src/modules/matches/matches.controller';
import { MatchService } from '../src/modules/matches/matches.service';
import type { SafeProfileDto } from '../src/modules/profiles/dto/safe-profile.dto';
import { ProfilesService } from '../src/modules/profiles/profiles.service';

const ACCESS_SECRET = 'test-access-secret';

type StoredMatch = {
  _id: Types.ObjectId;
  userAId: Types.ObjectId;
  userBId: Types.ObjectId;
  status: MatchStatus;
  interestId: Types.ObjectId;
  matchedAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

const asId = (value: unknown): string => String(value);
const pairKey = (a: unknown, b: unknown): string => `${asId(a)}:${asId(b)}`;

/** In-memory stand-in for the match model. */
class FakeMatchModel {
  readonly docs = new Map<string, StoredMatch>();

  findOneAndUpdate(
    filter: { userAId: Types.ObjectId; userBId: Types.ObjectId },
    update: { $setOnInsert: Omit<StoredMatch, '_id' | 'createdAt' | 'updatedAt'> },
  ) {
    const key = pairKey(filter.userAId, filter.userBId);

    return {
      exec: async (): Promise<StoredMatch> => {
        const existing = this.docs.get(key);
        if (existing) return existing;

        const now = new Date();
        const doc: StoredMatch = {
          ...update.$setOnInsert,
          _id: new Types.ObjectId(),
          createdAt: now,
          updatedAt: now,
        };
        this.docs.set(key, doc);
        return doc;
      },
    };
  }

  findOne(filter: { userAId: Types.ObjectId; userBId: Types.ObjectId }) {
    const key = pairKey(filter.userAId, filter.userBId);
    return { exec: async (): Promise<StoredMatch | null> => this.docs.get(key) ?? null };
  }

  find(filter: Record<string, unknown>) {
    const results = [...this.docs.values()].filter((doc) => this.matches(doc, filter));

    return { sort: () => ({ exec: async (): Promise<StoredMatch[]> => results }) };
  }

  private matches(doc: StoredMatch, filter: Record<string, unknown>): boolean {
    if (filter.status !== undefined && doc.status !== filter.status) return false;

    const alternatives = filter.$or as Array<Record<string, unknown>> | undefined;
    if (alternatives) {
      const matched = alternatives.some(
        (clause) =>
          (clause.userAId === undefined || asId(doc.userAId) === asId(clause.userAId)) &&
          (clause.userBId === undefined || asId(doc.userBId) === asId(clause.userBId)),
      );
      if (!matched) return false;
    }

    return true;
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

const CONFIG: Record<string, string> = { 'jwt.accessSecret': ACCESS_SECRET };
const configFake = { get: (key: string): string | undefined => CONFIG[key] };

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 24,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: 'hello',
});

/**
 * End-to-end test for the matches list. Mongo is replaced with an in-memory fake
 * so the suite exercises the real HTTP layer, routing, JwtAuthGuard and Swagger
 * generation without infrastructure.
 */
describe('Matches (e2e)', () => {
  let app: INestApplication;
  let model: FakeMatchModel;
  let profiles: FakeProfiles;
  let matchService: MatchService;

  const userA = new Types.ObjectId('a'.repeat(24)).toString();
  const userB = new Types.ObjectId('b'.repeat(24)).toString();
  const interestId = new Types.ObjectId().toString();

  const auth = (userId: string): string =>
    `Bearer ${new JwtService().sign(
      { sub: userId, email: `${userId.slice(0, 4)}@example.com`, type: 'access' },
      { secret: ACCESS_SECRET, expiresIn: 900 },
    )}`;

  beforeAll(async () => {
    model = new FakeMatchModel();
    profiles = new FakeProfiles();

    const moduleRef = await Test.createTestingModule({
      controllers: [MatchesController],
      providers: [
        MatchService,
        { provide: getModelToken(Match.name), useValue: model },
        { provide: ProfilesService, useValue: profiles },
        { provide: ConfigService, useValue: configFake },
        JwtService,
      ],
    }).compile();

    matchService = moduleRef.get(MatchService);

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

  const seedMatch = async (): Promise<void> => {
    await matchService.createFromAcceptedInterest({
      interestId,
      senderId: userA,
      receiverId: userB,
    });
  };

  describe('authentication', () => {
    it('rejects a request without a token (401)', async () => {
      await request(app.getHttpServer()).get('/api/v1/matches').expect(401);
    });
  });

  describe('GET /api/v1/matches', () => {
    beforeEach(() => {
      model.docs.clear();
      profiles.profiles.clear();
    });

    it('returns an empty list when the user has no matches (200)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/matches')
        .set('Authorization', auth(userA))
        .expect(200);

      expect(res.body).toEqual([]);
    });

    it('lists the match with the other participant (200)', async () => {
      await seedMatch();
      profiles.profiles.set(userB, profileFor(userB, 'Bob'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/matches')
        .set('Authorization', auth(userA))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].match).toMatchObject({ status: MatchStatus.Active, interestId });
      expect(res.body[0].user).toMatchObject({ userId: userB, name: 'Bob' });
    });

    it('lists the same match from the other side (200)', async () => {
      await seedMatch();
      profiles.profiles.set(userA, profileFor(userA, 'Ada'));

      const res = await request(app.getHttpServer())
        .get('/api/v1/matches')
        .set('Authorization', auth(userB))
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].user).toMatchObject({ userId: userA, name: 'Ada' });
    });

    it('does not leak matches the caller is not part of (200)', async () => {
      await seedMatch();
      profiles.profiles.set(userB, profileFor(userB, 'Bob'));

      const outsider = new Types.ObjectId().toString();
      const res = await request(app.getHttpServer())
        .get('/api/v1/matches')
        .set('Authorization', auth(outsider))
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  describe('OpenAPI document', () => {
    it('documents the matches endpoint under the Matches tag', () => {
      const document = createOpenApiDocument(app);

      expect(document.paths).toHaveProperty('/api/v1/matches');
      expect(document.tags?.map((tag) => tag.name)).toContain('Matches');
    });
  });
});
