import { Model, Types } from 'mongoose';
import { Gender } from '../../common/enums/gender.enum';
import { Profession } from '../../common/enums/profession.enum';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { ProfileDocument } from './profile.schema';
import { ProfilesService } from './profiles.service';

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

/** Minimal in-memory stand-in for the Mongoose profile model. */
class FakeProfileModel {
  private readonly docs = new Map<string, StoredProfile>();

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

describe('ProfilesService', () => {
  const userId = new Types.ObjectId().toString();
  let service: ProfilesService;

  const dto: UpsertProfileDto = {
    name: 'Maya',
    age: 24,
    gender: Gender.Woman,
    profession: Profession.DesignCreative,
  };

  beforeEach(() => {
    service = new ProfilesService(new FakeProfileModel() as unknown as Model<ProfileDocument>);
  });

  it('creates a profile and defaults the optional bio to an empty string', async () => {
    const profile = await service.upsert(userId, { ...dto });

    expect(profile).toMatchObject({
      userId,
      name: 'Maya',
      age: 24,
      gender: Gender.Woman,
      profession: Profession.DesignCreative,
      bio: '',
    });
  });

  it('returns null when the user has no profile yet', async () => {
    await expect(service.get(userId)).resolves.toBeNull();
  });

  it('reads back the stored profile', async () => {
    await service.upsert(userId, {
      ...dto,
      bio: 'Coffee snob',
      education: 'Design Lead @ Studio',
    });

    const profile = await service.get(userId);
    expect(profile).toMatchObject({ bio: 'Coffee snob', education: 'Design Lead @ Studio' });
  });

  it('updates in place on a second upsert (same id)', async () => {
    const first = await service.upsert(userId, { ...dto });
    const second = await service.upsert(userId, { ...dto, age: 30 });

    expect(second.id).toBe(first.id);
    expect(second.age).toBe(30);
  });
});
