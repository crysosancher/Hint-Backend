import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MatchStatus } from '../../common/enums/match-status.enum';
import { ProfilesService } from '../profiles/profiles.service';
import { MatchListItemDto, MatchResponseDto } from './dto/match-response.dto';
import { Match, MatchDocument } from './match.schema';

/**
 * Persistent matches — the durable outcome of a mutual interest.
 *
 * Creation is idempotent: participants are stored in a canonical order behind a
 * unique index, so a repeated or racing acceptance can only ever yield the one
 * existing match.
 */
@Injectable()
export class MatchService {
  constructor(
    @InjectModel(Match.name) private readonly matchModel: Model<MatchDocument>,
    private readonly profiles: ProfilesService,
  ) {}

  /**
   * Creates the match for a freshly accepted interest, or returns the existing
   * one. Safe to call more than once (e.g. a double-clicked accept).
   */
  async createFromAcceptedInterest(input: {
    interestId: string;
    senderId: string;
    receiverId: string;
  }): Promise<MatchResponseDto> {
    const match = await this.upsert(input);

    return this.toResponse(match);
  }

  /** The caller's active matches, newest first, with the other participant. */
  async listForUser(userId: string): Promise<MatchListItemDto[]> {
    const matches = await this.matchModel
      .find({
        status: MatchStatus.Active,
        $or: [{ userAId: userId }, { userBId: userId }],
      })
      .sort({ matchedAt: -1 })
      .exec();

    if (matches.length === 0) return [];

    const profiles = await this.profiles.findManySafeProfiles(
      matches.map((match) => this.counterpartId(match, userId)),
    );

    const items: MatchListItemDto[] = [];
    for (const match of matches) {
      const profile = profiles.get(this.counterpartId(match, userId));
      if (!profile) continue;

      items.push({ match: this.toResponse(match), user: profile });
    }

    return items;
  }

  private async upsert(input: {
    interestId: string;
    senderId: string;
    receiverId: string;
  }): Promise<MatchDocument> {
    const [userAId, userBId] = this.canonicalPair(input.senderId, input.receiverId);

    try {
      const match = await this.matchModel
        .findOneAndUpdate(
          { userAId, userBId },
          {
            $setOnInsert: {
              userAId,
              userBId,
              status: MatchStatus.Active,
              interestId: new Types.ObjectId(input.interestId),
              matchedAt: new Date(),
            },
          },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
        )
        .exec();

      if (!match) {
        throw new InternalServerErrorException('Failed to create match');
      }

      return match;
    } catch (error) {
      // A concurrent acceptance lost the unique-index race — the winner's match
      // is already there, so simply read it back instead of failing the request.
      if (this.isDuplicateKeyError(error)) {
        const existing = await this.matchModel.findOne({ userAId, userBId }).exec();
        if (existing) return existing;
      }
      throw error;
    }
  }

  /** Orders the pair so `A↔B` and `B↔A` collapse onto the same document. */
  private canonicalPair(a: string, b: string): [Types.ObjectId, Types.ObjectId] {
    const [first, second] = a < b ? [a, b] : [b, a];
    return [new Types.ObjectId(first), new Types.ObjectId(second)];
  }

  private counterpartId(match: MatchDocument, userId: string): string {
    return match.userAId.toString() === userId
      ? match.userBId.toString()
      : match.userAId.toString();
  }

  private toResponse(match: MatchDocument): MatchResponseDto {
    return {
      id: match._id.toString(),
      status: match.status,
      interestId: match.interestId.toString(),
      matchedAt: match.matchedAt.toISOString(),
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
