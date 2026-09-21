import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import type { AppConfiguration } from '../../config/configuration';
import { PresenceService } from '../presence/presence.service';
import { UpdateLocationDto } from './dto/update-location.dto';
import { LocationDocument } from './location.schema';
import { LocationService } from './location.service';

type StoredLocation = {
  _id: Types.ObjectId;
  userId: string;
  location: { type: 'Point'; coordinates: [number, number] };
  accuracyMeters: number;
  createdAt: Date;
  updatedAt: Date;
};

/** Minimal in-memory stand-in for the Mongoose location model. */
class FakeLocationModel {
  readonly docs = new Map<string, StoredLocation>();
  updateCount = 0;

  findOne(filter: { userId: string }) {
    const doc = this.docs.get(filter.userId) ?? null;
    return { exec: async (): Promise<StoredLocation | null> => (doc ? { ...doc } : null) };
  }

  findOneAndUpdate(
    filter: { userId: string },
    update: { $set: { location: StoredLocation['location']; accuracyMeters: number } },
  ) {
    const existing = this.docs.get(filter.userId);
    const now = new Date();
    const doc: StoredLocation = {
      _id: existing?._id ?? new Types.ObjectId(),
      userId: filter.userId,
      location: update.$set.location,
      accuracyMeters: update.$set.accuracyMeters,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.updateCount += 1;
    this.docs.set(filter.userId, doc);
    return { exec: async (): Promise<StoredLocation> => ({ ...doc }) };
  }

  deleteOne(filter: { userId: string }) {
    return {
      exec: async (): Promise<{ deletedCount: number }> => ({
        deletedCount: this.docs.delete(filter.userId) ? 1 : 0,
      }),
    };
  }

  deleteMany(filter: { updatedAt?: { $lte?: Date } }) {
    return {
      exec: async (): Promise<{ deletedCount: number }> => {
        const cutoff = filter.updatedAt?.$lte;
        let deletedCount = 0;
        for (const [userId, doc] of this.docs) {
          if (cutoff && doc.updatedAt.getTime() > cutoff.getTime()) continue;
          this.docs.delete(userId);
          deletedCount += 1;
        }
        return { deletedCount };
      },
    };
  }
}

/** Minimal in-memory stand-in for PresenceService. */
class FakePresence {
  active = true;

  async isActive(): Promise<boolean> {
    return this.active;
  }
}

const CONFIG: Record<string, number> = {
  'nearby.locationMaxAccuracyMeters': 100,
};

const configFake = {
  get: (key: string): number | undefined => CONFIG[key],
};

describe('LocationService', () => {
  const userId = new Types.ObjectId().toString();
  let model: FakeLocationModel;
  let presence: FakePresence;
  let service: LocationService;

  const fix: UpdateLocationDto = {
    latitude: 12.971599,
    longitude: 77.594566,
    accuracyMeters: 12.5,
  };

  beforeEach(() => {
    model = new FakeLocationModel();
    presence = new FakePresence();
    service = new LocationService(
      model as unknown as Model<LocationDocument>,
      presence as unknown as PresenceService,
      configFake as unknown as ConfigService<AppConfiguration, true>,
    );
  });

  it('stores a fix as a GeoJSON point in [longitude, latitude] order', async () => {
    const result = await service.update(userId, fix);

    expect(result).toMatchObject({
      userId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyMeters: fix.accuracyMeters,
    });
    expect(model.docs.get(userId)?.location).toEqual({
      type: 'Point',
      coordinates: [fix.longitude, fix.latitude],
    });
  });

  it('rejects a fix whose accuracy is worse than the configured maximum', async () => {
    await expect(service.update(userId, { ...fix, accuracyMeters: 150 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(model.updateCount).toBe(0);
  });

  it('rejects a fix while Nearby Mode is inactive', async () => {
    presence.active = false;

    await expect(service.update(userId, fix)).rejects.toBeInstanceOf(ConflictException);
    expect(model.updateCount).toBe(0);
  });

  it('coalesces concurrent fixes into a single write (latest wins)', async () => {
    const first: UpdateLocationDto = { latitude: 1, longitude: 2, accuracyMeters: 10 };
    const second: UpdateLocationDto = { latitude: 3, longitude: 4, accuracyMeters: 11 };

    await Promise.all([service.update(userId, first), service.update(userId, second)]);

    expect(model.updateCount).toBe(1);
    expect(model.docs.get(userId)?.location.coordinates).toEqual([
      second.longitude,
      second.latitude,
    ]);
  });

  it('returns null before any fix has been ingested', async () => {
    await expect(service.get(userId)).resolves.toBeNull();
  });

  it('reads back the stored fix', async () => {
    await service.update(userId, fix);

    await expect(service.get(userId)).resolves.toMatchObject({
      userId,
      latitude: fix.latitude,
      longitude: fix.longitude,
      accuracyMeters: fix.accuracyMeters,
    });
  });

  it('flushes pending fixes cleanly on shutdown', async () => {
    await service.update(userId, fix);

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();
    expect(model.updateCount).toBe(1);
  });

  describe('delete', () => {
    it('removes the stored fix', async () => {
      await service.update(userId, fix);
      await expect(service.get(userId)).resolves.not.toBeNull();

      await service.delete(userId);

      await expect(service.get(userId)).resolves.toBeNull();
      expect(model.docs.has(userId)).toBe(false);
    });

    it('is a no-op when nothing is stored', async () => {
      await expect(service.delete(userId)).resolves.toBeUndefined();
    });
  });

  describe('deleteStale', () => {
    it('deletes only the fixes older than the cutoff', async () => {
      const staleUserId = new Types.ObjectId().toString();
      await service.update(userId, fix);
      await service.update(staleUserId, fix);

      const stale = model.docs.get(staleUserId);
      if (stale) stale.updatedAt = new Date(Date.now() - 5 * 60 * 1000);

      await expect(service.deleteStale(120 * 1000)).resolves.toBe(1);
      expect(model.docs.has(staleUserId)).toBe(false);
      expect(model.docs.has(userId)).toBe(true);
    });
  });
});
