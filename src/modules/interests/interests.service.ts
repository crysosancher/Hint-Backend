import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { type FilterQuery, Model, Types } from 'mongoose';
import { InterestStatus } from '../../common/enums/interest-status.enum';
import { haversineDistanceMeters } from '../../common/geo/haversine';
import type { AppConfiguration } from '../../config/configuration';
import { LocationService } from '../location/location.service';
import { MatchService } from '../matches/matches.service';
import { PresenceService } from '../presence/presence.service';
import { ProfilesService } from '../profiles/profiles.service';
import {
  AcceptInterestResponseDto,
  InterestListItemDto,
  InterestResponseDto,
} from './dto/interest-response.dto';
import { Interest, InterestDocument } from './interest.schema';

/**
 * The interest lifecycle: `sent → accepted | ignored | expired`.
 *
 * Sending re-runs the discovery eligibility gate server-side (active Nearby
 * Mode, fresh fixes, within the radius, both profiled) so the 250 m rule cannot
 * be bypassed by calling this endpoint directly. Accepting is the only thing
 * that creates a match, and it is idempotent.
 */
@Injectable()
export class InterestsService {
  constructor(
    @InjectModel(Interest.name) private readonly interestModel: Model<InterestDocument>,
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly presence: PresenceService,
    private readonly locations: LocationService,
    private readonly profiles: ProfilesService,
    private readonly matches: MatchService,
  ) {}

  /** Sends an interest toward another discoverable user within the radius. */
  async send(senderId: string, receiverId: string): Promise<InterestResponseDto> {
    if (senderId === receiverId) {
      throw new BadRequestException('You cannot send an interest to yourself');
    }

    await this.assertMutuallyDiscoverable(senderId, receiverId);
    await this.assertNoActiveInterest(senderId, receiverId);

    const interest = await this.createInterest(senderId, receiverId);

    return this.toResponse(interest);
  }

  /** Persists a new pending interest, translating a racing duplicate to 409. */
  private async createInterest(senderId: string, receiverId: string): Promise<InterestDocument> {
    try {
      return await this.interestModel.create({
        senderId,
        receiverId,
        status: InterestStatus.Sent,
        expiresAt: new Date(Date.now() + this.ttlMs()),
      });
    } catch (error) {
      // Unique partial index: a racing duplicate send loses the insert here.
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('An active interest already exists with this user');
      }
      throw error;
    }
  }

  /** Received interests the caller can still act on, newest first. */
  listIncoming(userId: string): Promise<InterestListItemDto[]> {
    return this.list({ receiverId: userId }, (interest) => interest.senderId.toString());
  }

  /** Sent interests that are still pending, newest first. */
  listOutgoing(userId: string): Promise<InterestListItemDto[]> {
    return this.list({ senderId: userId }, (interest) => interest.receiverId.toString());
  }

  /**
   * Accepts a received interest and creates the persistent match.
   *
   * The match is written *before* the interest is marked accepted: should the
   * match write fail, the caller can simply retry, whereas the reverse order
   * could leave an accepted interest with no match.
   */
  async accept(receiverId: string, interestId: string): Promise<AcceptInterestResponseDto> {
    const interest = await this.findRespondable(receiverId, interestId);

    const match = await this.matches.createFromAcceptedInterest({
      interestId: interest._id.toString(),
      senderId: interest.senderId.toString(),
      receiverId: interest.receiverId.toString(),
    });

    interest.status = InterestStatus.Accepted;
    interest.respondedAt = new Date();
    await interest.save();

    return { interest: this.toResponse(interest), match };
  }

  /** Ignores a received interest without creating a match. */
  async ignore(receiverId: string, interestId: string): Promise<InterestResponseDto> {
    const interest = await this.findRespondable(receiverId, interestId);

    interest.status = InterestStatus.Ignored;
    interest.respondedAt = new Date();
    await interest.save();

    return this.toResponse(interest);
  }

  private async list(
    filter: FilterQuery<InterestDocument>,
    counterpartOf: (interest: InterestDocument) => string,
  ): Promise<InterestListItemDto[]> {
    const interests = await this.interestModel
      .find({
        ...filter,
        status: InterestStatus.Sent,
        // An already-expired document is not actionable, even if the Phase 4
        // sweep has not marked it yet.
        expiresAt: { $gt: new Date() },
      })
      .sort({ createdAt: -1 })
      .exec();

    if (interests.length === 0) return [];

    const profiles = await this.profiles.findManySafeProfiles(interests.map(counterpartOf));

    const items: InterestListItemDto[] = [];
    for (const interest of interests) {
      const profile = profiles.get(counterpartOf(interest));
      if (!profile) continue;

      items.push({ interest: this.toResponse(interest), user: profile });
    }

    return items;
  }

  /**
   * Loads an interest the caller is allowed to respond to.
   *
   * A missing interest and one addressed to somebody else are reported
   * identically, so the endpoint cannot be used to probe for interest ids.
   */
  private async findRespondable(
    receiverId: string,
    interestId: string,
  ): Promise<InterestDocument> {
    if (!Types.ObjectId.isValid(interestId)) {
      throw new NotFoundException('Interest not found');
    }

    const interest = await this.interestModel.findById(interestId).exec();
    if (!interest || interest.receiverId.toString() !== receiverId) {
      throw new NotFoundException('Interest not found');
    }

    if (interest.status !== InterestStatus.Sent) {
      throw new ConflictException(`This interest has already been ${interest.status}`);
    }

    if (interest.expiresAt.getTime() <= Date.now()) {
      // Lazy expiry until the Phase 4 queue takes over the sweep.
      interest.status = InterestStatus.Expired;
      await interest.save();
      throw new ConflictException('This interest has expired');
    }

    return interest;
  }

  /**
   * The server-authoritative gate, mirroring discovery exactly: both users in
   * Nearby Mode, both with a fresh fix and a profile, and the fixes within the
   * configured radius.
   */
  private async assertMutuallyDiscoverable(senderId: string, receiverId: string): Promise<void> {
    const [senderActive, receiverActive] = await Promise.all([
      this.presence.isActive(senderId),
      this.presence.isActive(receiverId),
    ]);
    if (!senderActive) {
      throw new ConflictException('Activate Nearby Mode before sending an interest');
    }
    if (!receiverActive) {
      throw new ConflictException('This user is not currently discoverable');
    }

    const [senderLocation, receiverLocation] = await Promise.all([
      this.locations.get(senderId),
      this.locations.get(receiverId),
    ]);
    if (!senderLocation) {
      throw new ConflictException('No location on record — update your location first');
    }
    if (!receiverLocation) {
      throw new ConflictException('This user is not currently discoverable');
    }

    const maxAgeMs = this.config.get('nearby.locationMaxAgeSeconds', { infer: true }) * 1000;
    const now = Date.now();
    if (now - Date.parse(senderLocation.updatedAt) > maxAgeMs) {
      throw new ConflictException('Your last location is too old — update your location first');
    }
    if (now - Date.parse(receiverLocation.updatedAt) > maxAgeMs) {
      throw new ConflictException('This user is not currently discoverable');
    }

    const profiles = await this.profiles.findManySafeProfiles([senderId, receiverId]);
    if (!profiles.has(senderId)) {
      throw new ConflictException('Create your profile before sending an interest');
    }
    if (!profiles.has(receiverId)) {
      throw new ConflictException('This user is not currently discoverable');
    }

    const radiusMeters = this.config.get('nearby.radiusMeters', { infer: true });
    if (haversineDistanceMeters(senderLocation, receiverLocation) > radiusMeters) {
      throw new ConflictException(`This user is outside your ${radiusMeters} m radius`);
    }
  }

  /**
   * Rejects a duplicate pending interest in *either* direction: if the other
   * user already sent one, the correct action is to accept it, not to send a
   * second.
   */
  private async assertNoActiveInterest(senderId: string, receiverId: string): Promise<void> {
    const existing = await this.interestModel
      .findOne({
        status: InterestStatus.Sent,
        expiresAt: { $gt: new Date() },
        $or: [
          { senderId, receiverId },
          { senderId: receiverId, receiverId: senderId },
        ],
      })
      .exec();

    if (existing) {
      throw new ConflictException('An active interest already exists with this user');
    }
  }

  private ttlMs(): number {
    return this.config.get('interest.ttlDays', { infer: true }) * 24 * 60 * 60 * 1000;
  }

  private toResponse(interest: InterestDocument): InterestResponseDto {
    return {
      id: interest._id.toString(),
      senderId: interest.senderId.toString(),
      receiverId: interest.receiverId.toString(),
      status: interest.status,
      createdAt: interest.createdAt.toISOString(),
      expiresAt: interest.expiresAt.toISOString(),
      respondedAt: interest.respondedAt?.toISOString(),
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
