import { BadRequestException } from '@nestjs/common';
import { Model, Types } from 'mongoose';
import { DEFAULT_AGE_MAX, DEFAULT_AGE_MIN } from '../../common/constants/age.constants';
import { Gender } from '../../common/enums/gender.enum';
import { RelationshipIntent } from '../../common/enums/relationship-intent.enum';
import { PreferenceDocument } from './preference.schema';
import { PreferencesService } from './preferences.service';

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

/** Minimal in-memory stand-in for the Mongoose preference model. */
class FakePreferenceModel {
  private readonly docs = new Map<string, StoredPreference>();

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

describe('PreferencesService', () => {
  const userId = new Types.ObjectId().toString();
  let service: PreferencesService;

  beforeEach(() => {
    service = new PreferencesService(
      new FakePreferenceModel() as unknown as Model<PreferenceDocument>,
    );
  });

  it('applies defaults on first write', async () => {
    const prefs = await service.upsert(userId, {});

    expect(prefs).toMatchObject({
      preferredGenders: [],
      ageMin: DEFAULT_AGE_MIN,
      ageMax: DEFAULT_AGE_MAX,
      relationshipIntent: RelationshipIntent.DatingRomance,
    });
  });

  it('rejects an inverted age range', async () => {
    await expect(service.upsert(userId, { ageMin: 40, ageMax: 20 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('validates the range against the stored value on a partial update', async () => {
    await service.upsert(userId, { ageMin: 22, ageMax: 30 });

    await expect(service.upsert(userId, { ageMax: 20 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('merges partial updates with the stored values', async () => {
    await service.upsert(userId, { ageMin: 22, ageMax: 30 });

    const updated = await service.upsert(userId, {
      relationshipIntent: RelationshipIntent.Friends,
    });

    expect(updated).toMatchObject({
      ageMin: 22,
      ageMax: 30,
      relationshipIntent: RelationshipIntent.Friends,
    });
  });

  it('returns null when the user has no preferences yet', async () => {
    await expect(service.get(userId)).resolves.toBeNull();
  });
});
