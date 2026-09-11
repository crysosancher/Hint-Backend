import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { DEFAULT_AGE_MAX, DEFAULT_AGE_MIN } from '../src/common/constants/age.constants';
import { Gender } from '../src/common/enums/gender.enum';
import { RelationshipIntent } from '../src/common/enums/relationship-intent.enum';
import { Preference } from '../src/modules/preferences/preference.schema';
import { PreferencesController } from '../src/modules/preferences/preferences.controller';
import { PreferencesService } from '../src/modules/preferences/preferences.service';

const ACCESS_SECRET = 'test-access-secret';

type StoredPreference = {
  _id: Types.ObjectId;
  userId: string;
  preferredGenders: Gender[];
  ageMin: number;
  ageMax: number;
  relationshipIntent: RelationshipIntent;
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory stand-in for the preference model, so the suite needs no Mongo. */
class FakePreferenceModel {
  private docs = new Map<string, StoredPreference>();

  reset(): void {
    this.docs = new Map();
  }

  findOne(filter: { userId: string }) {
    const doc = this.docs.get(filter.userId) ?? null;
    return { exec: async (): Promise<StoredPreference | null> => (doc ? { ...doc } : null) };
  }

  findOneAndUpdate(filter: { userId: string }, update: { $set: Partial<StoredPreference> }) {
    const existing = this.docs.get(filter.userId);
    const now = new Date();
    const doc: StoredPreference = {
      _id: existing?._id ?? new Types.ObjectId(),
      userId: filter.userId,
      preferredGenders: update.$set.preferredGenders ?? existing?.preferredGenders ?? [],
      ageMin: update.$set.ageMin ?? existing?.ageMin ?? DEFAULT_AGE_MIN,
      ageMax: update.$set.ageMax ?? existing?.ageMax ?? DEFAULT_AGE_MAX,
      relationshipIntent:
        update.$set.relationshipIntent ??
        existing?.relationshipIntent ??
        RelationshipIntent.DatingRomance,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.docs.set(filter.userId, doc);
    return { exec: async (): Promise<StoredPreference> => ({ ...doc }) };
  }
}

describe('Preferences (e2e)', () => {
  let app: INestApplication;
  let fakeModel: FakePreferenceModel;

  const userId = new Types.ObjectId().toString();
  const accessToken = new JwtService().sign(
    { sub: userId, email: 'ada@example.com', type: 'access' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );
  const auth = (): string => `Bearer ${accessToken}`;

  beforeAll(async () => {
    fakeModel = new FakePreferenceModel();

    const moduleRef = await Test.createTestingModule({
      controllers: [PreferencesController],
      providers: [
        PreferencesService,
        { provide: getModelToken(Preference.name), useValue: fakeModel },
        JwtService,
        { provide: ConfigService, useValue: { get: () => ACCESS_SECRET } },
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

  beforeEach(() => fakeModel.reset());

  afterAll(async () => {
    await app.close();
  });

  describe('authentication', () => {
    it('rejects a request without a token (401)', async () => {
      await request(app.getHttpServer()).patch('/api/v1/preferences').send({}).expect(401);
    });
  });

  describe('PATCH /api/v1/preferences', () => {
    it('applies defaults when the body is empty (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({})
        .expect(200);

      expect(res.body).toMatchObject({
        userId,
        preferredGenders: [],
        ageMin: DEFAULT_AGE_MIN,
        ageMax: DEFAULT_AGE_MAX,
        relationshipIntent: RelationshipIntent.DatingRomance,
      });
    });

    it('stores the provided values (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({
          preferredGenders: [Gender.Woman, Gender.NonBinary],
          ageMin: 22,
          ageMax: 29,
          relationshipIntent: RelationshipIntent.Friends,
        })
        .expect(200);

      expect(res.body).toMatchObject({
        preferredGenders: [Gender.Woman, Gender.NonBinary],
        ageMin: 22,
        ageMax: 29,
        relationshipIntent: RelationshipIntent.Friends,
      });
    });

    it('rejects an unknown relationship intent (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ relationshipIntent: 'marriage' })
        .expect(400);
    });

    it('rejects an unknown preferred gender (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ preferredGenders: ['alien'] })
        .expect(400);
    });

    it('rejects an inverted age range (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ ageMin: 40, ageMax: 20 })
        .expect(400);
    });

    it('rejects an age below 13 and above 100 (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ ageMin: 12 })
        .expect(400);

      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ ageMax: 101 })
        .expect(400);
    });
  });

  describe('GET /api/v1/preferences', () => {
    it('returns 404 before preferences exist', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/preferences')
        .set('Authorization', auth())
        .expect(404);
    });

    it('returns the stored preferences (200)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/preferences')
        .set('Authorization', auth())
        .send({ relationshipIntent: RelationshipIntent.DeepConnection })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/preferences')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body.relationshipIntent).toBe(RelationshipIntent.DeepConnection);
    });
  });
});
