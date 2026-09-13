import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Gender } from '../../common/enums/gender.enum';
import { InterestStatus } from '../../common/enums/interest-status.enum';
import { MatchStatus } from '../../common/enums/match-status.enum';
import { Profession } from '../../common/enums/profession.enum';
import type { AppConfiguration } from '../../config/configuration';
import type { LocationResponseDto } from '../location/dto/location-response.dto';
import { LocationService } from '../location/location.service';
import type { MatchResponseDto } from '../matches/dto/match-response.dto';
import { MatchService } from '../matches/matches.service';
import { PresenceService } from '../presence/presence.service';
import type { SafeProfileDto } from '../profiles/dto/safe-profile.dto';
import { ProfilesService } from '../profiles/profiles.service';
import { InterestDocument } from './interest.schema';
import { InterestsService } from './interests.service';

type StoredInterest = {
  _id: Types.ObjectId;
  senderId: Types.ObjectId;
  receiverId: Types.ObjectId;
  status: InterestStatus;
  expiresAt: Date;
  respondedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
};

const asId = (value: unknown): string => String(value);

/**
 * In-memory stand-in for the Mongoose interest model. It understands just the
 * handful of query shapes the service actually issues (status + expiry + either
 * participant + `$or`), which keeps the service logic under test rather than the
 * MongoDB driver.
 */
class FakeInterestModel {
  readonly docs = new Map<string, StoredInterest>();

  async create(input: {
    senderId: string;
    receiverId: string;
    status: InterestStatus;
    expiresAt: Date;
  }): Promise<InterestDocument> {
    const now = new Date();
    return this.persist({
      _id: new Types.ObjectId(),
      senderId: new Types.ObjectId(input.senderId),
      receiverId: new Types.ObjectId(input.receiverId),
      status: input.status,
      expiresAt: input.expiresAt,
      createdAt: now,
      updatedAt: now,
    });
  }

  findOne(filter: Record<string, unknown>) {
    return { exec: async (): Promise<InterestDocument | null> => this.first(filter) };
  }

  findById(id: string) {
    return {
      exec: async (): Promise<InterestDocument | null> => {
        const doc = this.docs.get(id);
        return doc ? this.hydrate(doc) : null;
      },
    };
  }

  find(filter: Record<string, unknown>) {
    return {
      sort: () => ({
        exec: async (): Promise<InterestDocument[]> =>
          this.matching(filter)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .map((doc) => this.hydrate(doc)),
      }),
    };
  }

  private first(filter: Record<string, unknown>): InterestDocument | null {
    const [doc] = this.matching(filter);
    return doc ? this.hydrate(doc) : null;
  }

  private matching(filter: Record<string, unknown>): StoredInterest[] {
    return [...this.docs.values()].filter((doc) => this.matches(doc, filter));
  }

  private matches(doc: StoredInterest, filter: Record<string, unknown>): boolean {
    if (filter.status !== undefined && doc.status !== filter.status) return false;

    const expiresAt = filter.expiresAt as { $gt?: Date } | undefined;
    if (expiresAt?.$gt && doc.expiresAt.getTime() <= expiresAt.$gt.getTime()) return false;

    if (filter.senderId !== undefined && asId(doc.senderId) !== asId(filter.senderId)) return false;
    if (filter.receiverId !== undefined && asId(doc.receiverId) !== asId(filter.receiverId)) {
      return false;
    }

    const alternatives = filter.$or as Array<Record<string, unknown>> | undefined;
    if (alternatives && !alternatives.some((clause) => this.matches(doc, clause))) return false;

    return true;
  }

  private persist(doc: StoredInterest): InterestDocument {
    this.docs.set(doc._id.toString(), doc);
    return this.hydrate(doc);
  }

  private hydrate(doc: StoredInterest): InterestDocument {
    const store = this.docs;
    const document = doc as StoredInterest & { save: () => Promise<StoredInterest> };
    document.save = async (): Promise<StoredInterest> => {
      store.set(doc._id.toString(), doc);
      return doc;
    };

    return document as unknown as InterestDocument;
  }
}

/** Toggleable presence stand-in. */
class FakePresence {
  readonly active = new Set<string>();

  async isActive(userId: string): Promise<boolean> {
    return this.active.has(userId);
  }
}

class FakeLocations {
  readonly fixes = new Map<string, LocationResponseDto>();

  async get(userId: string): Promise<LocationResponseDto | null> {
    return this.fixes.get(userId) ?? null;
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

class FakeMatches {
  readonly calls: Array<{ interestId: string; senderId: string; receiverId: string }> = [];

  async createFromAcceptedInterest(input: {
    interestId: string;
    senderId: string;
    receiverId: string;
  }): Promise<MatchResponseDto> {
    this.calls.push(input);
    return {
      id: new Types.ObjectId().toString(),
      status: MatchStatus.Active,
      interestId: input.interestId,
      matchedAt: new Date().toISOString(),
    };
  }
}

const CONFIG: Record<string, number> = {
  'nearby.radiusMeters': 250,
  'nearby.locationMaxAgeSeconds': 120,
  'interest.ttlDays': 7,
};

const configFake = { get: (key: string): number | undefined => CONFIG[key] };

// ~222 m apart: inside the 250 m radius.
const SENDER_POINT = { latitude: 0, longitude: 0 };
const RECEIVER_POINT = { latitude: 0, longitude: 0.002 };
// ~334 m apart: outside the radius.
const FAR_POINT = { latitude: 0, longitude: 0.003 };

const fix = (
  userId: string,
  point: { latitude: number; longitude: number },
): LocationResponseDto => ({
  userId,
  latitude: point.latitude,
  longitude: point.longitude,
  accuracyMeters: 10,
  updatedAt: new Date().toISOString(),
});

const profileFor = (userId: string, name: string): SafeProfileDto => ({
  userId,
  name,
  age: 25,
  gender: Gender.Woman,
  profession: Profession.DesignCreative,
  bio: '',
});

describe('InterestsService', () => {
  const senderId = new Types.ObjectId().toString();
  const receiverId = new Types.ObjectId().toString();

  let model: FakeInterestModel;
  let presence: FakePresence;
  let locations: FakeLocations;
  let profiles: FakeProfiles;
  let matches: FakeMatches;
  let service: InterestsService;

  const makeDiscoverable = (): void => {
    presence.active.add(senderId);
    presence.active.add(receiverId);
    locations.fixes.set(senderId, fix(senderId, SENDER_POINT));
    locations.fixes.set(receiverId, fix(receiverId, RECEIVER_POINT));
    profiles.profiles.set(senderId, profileFor(senderId, 'Sender'));
    profiles.profiles.set(receiverId, profileFor(receiverId, 'Receiver'));
  };

  beforeEach(() => {
    model = new FakeInterestModel();
    presence = new FakePresence();
    locations = new FakeLocations();
    profiles = new FakeProfiles();
    matches = new FakeMatches();

    service = new InterestsService(
      model as unknown as Model<InterestDocument>,
      configFake as unknown as ConfigService<AppConfiguration, true>,
      presence as unknown as PresenceService,
      locations as unknown as LocationService,
      profiles as unknown as ProfilesService,
      matches as unknown as MatchService,
    );

    makeDiscoverable();
  });

  describe('send', () => {
    it('creates a pending interest with an expiry derived from config', async () => {
      const before = Date.now();
      const interest = await service.send(senderId, receiverId);

      expect(interest).toMatchObject({
        senderId,
        receiverId,
        status: InterestStatus.Sent,
      });
      expect(model.docs.size).toBe(1);

      const expected = before + 7 * 24 * 60 * 60 * 1000;
      expect(Math.abs(Date.parse(interest.expiresAt) - expected)).toBeLessThan(5000);
    });

    it('rejects an interest sent to yourself', async () => {
      await expect(service.send(senderId, senderId)).rejects.toBeInstanceOf(BadRequestException);
      expect(model.docs.size).toBe(0);
    });

    it('rejects when the sender is not in Nearby Mode', async () => {
      presence.active.delete(senderId);

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the receiver is not in Nearby Mode', async () => {
      presence.active.delete(receiverId);

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the receiver is outside the 250 m radius', async () => {
      locations.fixes.set(receiverId, fix(receiverId, FAR_POINT));

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the sender has no location', async () => {
      locations.fixes.delete(senderId);

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the receiver location is stale', async () => {
      locations.fixes.set(receiverId, {
        ...fix(receiverId, RECEIVER_POINT),
        updatedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      });

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when the receiver has no profile', async () => {
      profiles.profiles.delete(receiverId);

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects a duplicate pending interest in either direction', async () => {
      await service.send(senderId, receiverId);

      await expect(service.send(senderId, receiverId)).rejects.toBeInstanceOf(ConflictException);
      await expect(service.send(receiverId, senderId)).rejects.toBeInstanceOf(ConflictException);
      expect(model.docs.size).toBe(1);
    });

    it('allows a new interest once the previous one was resolved', async () => {
      const first = await service.send(senderId, receiverId);
      await service.ignore(receiverId, first.id);

      await expect(service.send(senderId, receiverId)).resolves.toMatchObject({
        status: InterestStatus.Sent,
      });
      expect(model.docs.size).toBe(2);
    });

    it('ignores an already-expired pending interest when checking duplicates', async () => {
      const stale = await service.send(senderId, receiverId);
      // Age the stored document past its expiry, as the Phase 4 sweep would.
      const doc = model.docs.get(stale.id);
      if (doc) doc.expiresAt = new Date(Date.now() - 1000);

      await expect(service.send(senderId, receiverId)).resolves.toMatchObject({
        status: InterestStatus.Sent,
      });
    });
  });

  describe('accept and ignore', () => {
    it('accepts an interest and creates the persistent match', async () => {
      const interest = await service.send(senderId, receiverId);

      const result = await service.accept(receiverId, interest.id);

      expect(result.interest).toMatchObject({ id: interest.id, status: InterestStatus.Accepted });
      expect(typeof result.interest.respondedAt).toBe('string');
      expect(result.match).toMatchObject({ status: MatchStatus.Active, interestId: interest.id });
      expect(matches.calls).toEqual([{ interestId: interest.id, senderId, receiverId }]);
      expect(model.docs.get(interest.id)?.status).toBe(InterestStatus.Accepted);
    });

    it('only lets the receiver respond', async () => {
      const interest = await service.send(senderId, receiverId);

      await expect(service.accept(senderId, interest.id)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects a malformed interest id', async () => {
      await expect(service.accept(receiverId, 'not-an-object-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('rejects responding twice to the same interest', async () => {
      const interest = await service.send(senderId, receiverId);
      await service.accept(receiverId, interest.id);

      await expect(service.accept(receiverId, interest.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('refuses to accept an expired interest and marks it expired', async () => {
      const interest = await service.send(senderId, receiverId);
      const doc = model.docs.get(interest.id);
      if (doc) doc.expiresAt = new Date(Date.now() - 1000);

      await expect(service.accept(receiverId, interest.id)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(model.docs.get(interest.id)?.status).toBe(InterestStatus.Expired);
      expect(matches.calls).toHaveLength(0);
    });

    it('ignores an interest without creating a match', async () => {
      const interest = await service.send(senderId, receiverId);

      const result = await service.ignore(receiverId, interest.id);

      expect(result).toMatchObject({ id: interest.id, status: InterestStatus.Ignored });
      expect(matches.calls).toHaveLength(0);
    });
  });

  describe('listing', () => {
    it('returns incoming interests with the sender profile', async () => {
      const interest = await service.send(senderId, receiverId);

      const incoming = await service.listIncoming(receiverId);

      expect(incoming).toHaveLength(1);
      expect(incoming[0].interest.id).toBe(interest.id);
      expect(incoming[0].user).toMatchObject({ userId: senderId, name: 'Sender' });
    });

    it('returns outgoing interests with the receiver profile', async () => {
      const interest = await service.send(senderId, receiverId);

      const outgoing = await service.listOutgoing(senderId);

      expect(outgoing).toHaveLength(1);
      expect(outgoing[0].interest.id).toBe(interest.id);
      expect(outgoing[0].user).toMatchObject({ userId: receiverId, name: 'Receiver' });
    });

    it('omits resolved interests from the inbox', async () => {
      const interest = await service.send(senderId, receiverId);
      await service.ignore(receiverId, interest.id);

      await expect(service.listIncoming(receiverId)).resolves.toEqual([]);
    });

    it('omits expired interests from the inbox', async () => {
      const interest = await service.send(senderId, receiverId);
      const doc = model.docs.get(interest.id);
      if (doc) doc.expiresAt = new Date(Date.now() - 1000);

      await expect(service.listIncoming(receiverId)).resolves.toEqual([]);
    });
  });
});
