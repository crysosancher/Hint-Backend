import {
  BadRequestException,
  ConflictException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { KeyedDebouncer } from '../../common/debounce/keyed-debouncer';
import type { GeoCoordinate } from '../../common/geo/haversine';
import type { AppConfiguration } from '../../config/configuration';
import { PresenceService } from '../presence/presence.service';
import { LocationResponseDto } from './dto/location-response.dto';
import { UpdateLocationDto } from './dto/update-location.dto';
import { Location, LocationDocument } from './location.schema';

/** A candidate returned by the server-authoritative geospatial query. */
export interface NearbyLocation {
  userId: string;

  /** Great-circle distance in metres, computed by MongoDB (never the client). */
  distanceMeters: number;
}

/**
 * Latest-location ingestion.
 *
 * A fix is only accepted while Nearby Mode is active and only when its
 * reported accuracy is good enough, so discovery can trust every stored
 * point. Writes are coalesced per user (see {@link KeyedDebouncer}) before
 * landing in MongoDB.
 */
@Injectable()
export class LocationService implements OnModuleDestroy {
  private readonly debouncer: KeyedDebouncer<UpdateLocationDto>;

  constructor(
    @InjectModel(Location.name) private readonly locationModel: Model<LocationDocument>,
    private readonly presence: PresenceService,
    private readonly config: ConfigService<AppConfiguration, true>,
  ) {
    this.debouncer = new KeyedDebouncer<UpdateLocationDto>((userId, dto) =>
      this.persist(userId, dto),
    );
  }

  /** Validates, coalesces and stores the caller's latest location. */
  async update(userId: string, dto: UpdateLocationDto): Promise<LocationResponseDto> {
    const maxAccuracy = this.config.get('nearby.locationMaxAccuracyMeters', { infer: true });
    if (dto.accuracyMeters > maxAccuracy) {
      throw new BadRequestException(`accuracyMeters must not exceed ${maxAccuracy} metres`);
    }

    if (!(await this.presence.isActive(userId))) {
      throw new ConflictException('Nearby Mode is not active');
    }

    await this.debouncer.schedule(userId, dto);

    return {
      userId,
      latitude: dto.latitude,
      longitude: dto.longitude,
      accuracyMeters: dto.accuracyMeters,
      updatedAt: new Date().toISOString(),
    };
  }

  /** The caller's latest stored location, or `null` if none has been ingested. */
  async get(userId: string): Promise<LocationResponseDto | null> {
    // Read-your-writes: drain any pending coalesced fix before reading.
    await this.debouncer.flushKey(userId);

    const document = await this.locationModel.findOne({ userId }).exec();
    if (!document) return null;

    const [longitude, latitude] = document.location.coordinates;
    return {
      userId: document.userId.toString(),
      latitude,
      longitude,
      accuracyMeters: document.accuracyMeters,
      updatedAt: document.updatedAt.toISOString(),
    };
  }

  /**
   * Removes a user's stored location.
   *
   * Used once a Nearby Mode session ends: a location is only meaningful while
   * its owner is discoverable. Any coalesced fix still sitting in the debouncer
   * is flushed first, otherwise that write would re-create the document.
   */
  async delete(userId: string): Promise<void> {
    await this.debouncer.flushKey(userId);
    await this.locationModel.deleteOne({ userId }).exec();
  }

  /**
   * Deletes every fix older than `olderThanMs` — the Phase 4 cleanup sweep.
   *
   * A fix that has aged past the discovery freshness window can never make its
   * owner a candidate again, and the MVP keeps no movement history, so it is
   * safe to drop. A fix accepted after this query and still in the debouncer is
   * simply written back by its upsert on the next flush.
   *
   * @returns the number of deleted documents.
   */
  async deleteStale(olderThanMs: number): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMs);
    const result = await this.locationModel.deleteMany({ updatedAt: { $lte: cutoff } }).exec();

    return result.deletedCount;
  }

  /**
   * Other users whose latest fix is within `radiusMeters` of `point`, using the
   * `2dsphere` index.
   *
   * The `$geoNear.query` filter is applied *before* candidate documents are
   * scored, so only other users' **fresh** fixes are considered. Distances come
   * from MongoDB itself, which keeps the 250 m rule server-authoritative — the
   * caller can never influence it.
   */
  async findNearby(
    point: GeoCoordinate,
    options: { radiusMeters: number; maxAgeSeconds: number; excludeUserId: string },
  ): Promise<NearbyLocation[]> {
    const cutoff = new Date(Date.now() - options.maxAgeSeconds * 1000);

    const results = await this.locationModel
      .aggregate<{ userId: Types.ObjectId; distanceMeters: number }>([
        {
          $geoNear: {
            // GeoJSON order is [longitude, latitude].
            near: { type: 'Point', coordinates: [point.longitude, point.latitude] },
            distanceField: 'distanceMeters',
            maxDistance: options.radiusMeters,
            spherical: true,
            query: {
              userId: { $ne: new Types.ObjectId(options.excludeUserId) },
              updatedAt: { $gte: cutoff },
            },
          },
        },
        { $project: { _id: 0, userId: 1, distanceMeters: 1 } },
      ])
      .exec();

    return results.map((result) => ({
      userId: result.userId.toString(),
      distanceMeters: result.distanceMeters,
    }));
  }

  /** Flush accepted fixes on shutdown so a graceful restart loses nothing. */
  async onModuleDestroy(): Promise<void> {
    await this.debouncer.flushAll();
  }

  private async persist(userId: string, dto: UpdateLocationDto): Promise<void> {
    await this.locationModel
      .findOneAndUpdate(
        { userId },
        {
          $set: {
            // GeoJSON order is [longitude, latitude].
            location: { type: 'Point', coordinates: [dto.longitude, dto.latitude] },
            accuracyMeters: dto.accuracyMeters,
          },
        },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .exec();
  }
}
