import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getModelToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { Types } from 'mongoose';
import request from 'supertest';
import { Gender } from '../src/common/enums/gender.enum';
import { Profession } from '../src/common/enums/profession.enum';
import { Profile } from '../src/modules/profiles/profile.schema';
import { ProfilesController } from '../src/modules/profiles/profiles.controller';
import { ProfilesService } from '../src/modules/profiles/profiles.service';

const ACCESS_SECRET = 'test-access-secret';

type StoredProfile = {
  _id: Types.ObjectId;
  userId: string;
  name: string;
  age: number;
  gender: Gender;
  profession: Profession;
  education?: string;
  photoUrl?: string;
  bio: string;
  createdAt: Date;
  updatedAt: Date;
};

/** In-memory stand-in for the profile model, so the suite needs no Mongo. */
class FakeProfileModel {
  private docs = new Map<string, StoredProfile>();

  reset(): void {
    this.docs = new Map();
  }

  findOne(filter: { userId: string }) {
    const doc = this.docs.get(filter.userId) ?? null;
    return { exec: async (): Promise<StoredProfile | null> => (doc ? { ...doc } : null) };
  }

  findOneAndUpdate(filter: { userId: string }, update: { $set: Partial<StoredProfile> }) {
    const existing = this.docs.get(filter.userId);
    const now = new Date();
    const doc: StoredProfile = {
      _id: existing?._id ?? new Types.ObjectId(),
      userId: filter.userId,
      name: update.$set.name ?? existing?.name ?? '',
      age: update.$set.age ?? existing?.age ?? 0,
      gender: update.$set.gender ?? existing?.gender ?? Gender.Woman,
      profession: update.$set.profession ?? existing?.profession ?? Profession.Other,
      education: update.$set.education ?? existing?.education,
      photoUrl: update.$set.photoUrl ?? existing?.photoUrl,
      bio: update.$set.bio ?? existing?.bio ?? '',
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.docs.set(filter.userId, doc);
    return { exec: async (): Promise<StoredProfile> => ({ ...doc }) };
  }
}

describe('Profiles (e2e)', () => {
  let app: INestApplication;
  let fakeModel: FakeProfileModel;

  const userId = new Types.ObjectId().toString();
  const jwt = new JwtService();
  const accessToken = jwt.sign(
    { sub: userId, email: 'ada@example.com', type: 'access' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );
  const refreshToken = jwt.sign(
    { sub: userId, type: 'refresh', jti: 'jti-1' },
    { secret: ACCESS_SECRET, expiresIn: 900 },
  );

  const validBody = {
    name: 'Maya',
    age: 24,
    gender: Gender.Woman,
    profession: Profession.DesignCreative,
  };

  const auth = (): string => `Bearer ${accessToken}`;

  beforeAll(async () => {
    fakeModel = new FakeProfileModel();

    const moduleRef = await Test.createTestingModule({
      controllers: [ProfilesController],
      providers: [
        ProfilesService,
        { provide: getModelToken(Profile.name), useValue: fakeModel },
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
      await request(app.getHttpServer()).patch('/api/v1/profile').send(validBody).expect(401);
    });

    it('rejects a malformed token (401)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', 'Bearer not-a-jwt')
        .send(validBody)
        .expect(401);
    });

    it('rejects a refresh token used as a bearer credential (401)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', `Bearer ${refreshToken}`)
        .send(validBody)
        .expect(401);
    });
  });

  describe('PATCH /api/v1/profile', () => {
    it('creates the profile and returns it (200)', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send(validBody)
        .expect(200);

      expect(res.body).toMatchObject({
        userId,
        name: 'Maya',
        age: 24,
        gender: Gender.Woman,
        profession: Profession.DesignCreative,
        bio: '',
      });
    });

    it('rejects an unknown gender enum value (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ ...validBody, gender: 'alien' })
        .expect(400);
    });

    it('rejects an unknown profession enum value (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ ...validBody, profession: 'astronaut' })
        .expect(400);
    });

    it('rejects an age below 13 (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ ...validBody, age: 12 })
        .expect(400);
    });

    it('rejects a bio longer than 80 characters (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ ...validBody, bio: 'x'.repeat(81) })
        .expect(400);
    });

    it('rejects a missing required field (400)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ age: validBody.age, gender: validBody.gender, profession: validBody.profession })
        .expect(400);
    });
  });

  describe('GET /api/v1/profile', () => {
    it('returns 404 before a profile exists', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', auth())
        .expect(404);
    });

    it('returns the stored profile (200)', async () => {
      await request(app.getHttpServer())
        .patch('/api/v1/profile')
        .set('Authorization', auth())
        .send({ ...validBody, education: 'Design Lead @ Studio', bio: 'Coffee snob' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/v1/profile')
        .set('Authorization', auth())
        .expect(200);

      expect(res.body).toMatchObject({
        name: 'Maya',
        education: 'Design Lead @ Studio',
        bio: 'Coffee snob',
      });
    });
  });
});
