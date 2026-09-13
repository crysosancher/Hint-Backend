import { Model, Types } from 'mongoose';
import { Gender } from '../../common/enums/gender.enum';
import { MatchStatus } from '../../common/enums/match-status.enum';
import { Profession } from '../../common/enums/profession.enum';
import type { SafeProfileDto } from '../profiles/dto/safe-profile.dto';
import { ProfilesService } from '../profiles/profiles.service';
import { MatchDocument } from './match.schema';
import { MatchService } from './matches.service';

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

/** In-memory stand-in for the Mongoose match model. */
class FakeMatchModel {
  readonly docs = new Map<string, StoredMatch>();
  /** Set to simulate the unique-index race on the next upsert. */
  duplicateNextUpsert = false;

  findOneAndUpdate(
    filter: { userAId: Types.ObjectId; userBId: Types.ObjectId },
    update: { $setOnInsert: Omit<StoredMatch, '_id' | 'createdAt' | 'updatedAt'> },
  ) {
    const key = pairKey(filter.userAId, filter.userBId);

    return {
      exec: async (): Promise<MatchDocument> => {
        if (this.duplicateNextUpsert) {
          this.duplicateNextUpsert = false;
          throw Object.assign(new Error('E11000 duplicate key'), { code: 11000 });
        }

        const existing = this.docs.get(key);
        if (existing) return existing as unknown as MatchDocument;

        const now = new Date();
        const doc: StoredMatch = { ...update.$setOnInsert, _id: new Types.ObjectId(), createdAt: now, updatedAt: now };
        this.docs.set(key, doc);
        return doc as unknown as MatchDocument;
      },
    };
  }

  findOne(filter: { userAId: Types.ObjectId; userBId: Types.ObjectId }) {
    const key = pairKey(filter.userAId, filter.userBId);

    return {
      exec: async (): Promise<MatchDocument | null> =>
        (this.docs.get(key) as unknown as MatchDocument) ?? null,
    };
  }

  find(filter: Record<string, unknown>) {
    const results = [...this.docs.values()].filter((doc) => this.matches(doc, filter));

    return {
      sort: () => ({
        exec: async (): Promise<MatchDocument[]> => results as unknown as MatchDocument[],
      }),
    };
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

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 25,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: '',
});

describe('MatchService', () => {
  // Deliberately ordered ids so the canonical ordering is unambiguous.
  const smaller = new Types.ObjectId('a'.repeat(24)).toString();
  const larger = new Types.ObjectId('b'.repeat(24)).toString();
  const interestId = new Types.ObjectId().toString();

  let model: FakeMatchModel;
  let profiles: FakeProfiles;
  let service: MatchService;

  beforeEach(() => {
    model = new FakeMatchModel();
    profiles = new FakeProfiles();
    service = new MatchService(
      model as unknown as Model<MatchDocument>,
      profiles as unknown as ProfilesService,
    );
  });

  it('creates a match with its status and matched timestamp', async () => {
    const match = await service.createFromAcceptedInterest({
      interestId,
      senderId: smaller,
      receiverId: larger,
    });

    expect(match).toMatchObject({ status: MatchStatus.Active, interestId });
    expect(typeof match.matchedAt).toBe('string');
  });

  it('stores participants in a canonical order, whichever direction is used', async () => {
    const first = await service.createFromAcceptedInterest({
      interestId,
      senderId: larger,
      receiverId: smaller,
    });
    const second = await service.createFromAcceptedInterest({
      interestId,
      senderId: smaller,
      receiverId: larger,
    });

    expect(second.id).toBe(first.id);
    expect(model.docs.size).toBe(1);

    const [doc] = [...model.docs.values()];
    expect(doc.userAId.toString()).toBe(smaller);
    expect(doc.userBId.toString()).toBe(larger);
  });

  it('survives losing the unique-index race by reading back the winner', async () => {
    const first = await service.createFromAcceptedInterest({
      interestId,
      senderId: smaller,
      receiverId: larger,
    });

    model.duplicateNextUpsert = true;
    const second = await service.createFromAcceptedInterest({
      interestId,
      senderId: larger,
      receiverId: smaller,
    });

    expect(second.id).toBe(first.id);
    expect(model.docs.size).toBe(1);
  });

  it('lists the caller\u2019s matches with the other participant', async () => {
    await service.createFromAcceptedInterest({ interestId, senderId: smaller, receiverId: larger });
    profiles.profiles.set(larger, profileFor(larger, 'Other'));

    const fromSmaller = await service.listForUser(smaller);

    expect(fromSmaller).toHaveLength(1);
    expect(fromSmaller[0].user.userId).toBe(larger);
    expect(fromSmaller[0].match).toMatchObject({ status: MatchStatus.Active, interestId });
  });

  it('lists the same match from the other participant\u2019s side', async () => {
    await service.createFromAcceptedInterest({ interestId, senderId: smaller, receiverId: larger });
    profiles.profiles.set(smaller, profileFor(smaller, 'Other'));

    const fromLarger = await service.listForUser(larger);

    expect(fromLarger).toHaveLength(1);
    expect(fromLarger[0].user.userId).toBe(smaller);
  });

  it('returns an empty list when the user has no matches', async () => {
    await expect(service.listForUser(smaller)).resolves.toEqual([]);
  });

  it('omits matches whose counterpart profile is missing', async () => {
    await service.createFromAcceptedInterest({ interestId, senderId: smaller, receiverId: larger });

    await expect(service.listForUser(smaller)).resolves.toEqual([]);
  });
});
