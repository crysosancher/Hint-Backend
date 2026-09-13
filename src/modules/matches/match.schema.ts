import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MatchStatus } from '../../common/enums/match-status.enum';

export type MatchDocument = HydratedDocument<Match>;

/**
 * A persistent mutual match, created when one user accepts another's interest.
 *
 * Participants are stored in a **canonical order** (smallest user id first) so
 * the pair `A↔B` always maps onto the same document — that is what lets a unique
 * index guarantee one match per pair regardless of who accepted.
 *
 * Unlike discovery and interest creation, a match is *not* bound to the 250 m
 * radius: once created it survives both users walking away.
 */
@Schema({ timestamps: true, collection: 'matches' })
export class Match {
  _id!: Types.ObjectId;

  /** Canonical first participant (lexicographically smaller user id). */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userAId!: Types.ObjectId;

  /** Canonical second participant. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userBId!: Types.ObjectId;

  @Prop({ type: String, enum: MatchStatus, default: MatchStatus.Active })
  status!: MatchStatus;

  /** The interest whose acceptance produced this match (audit trail). */
  @Prop({ type: Types.ObjectId, ref: 'Interest', required: true })
  interestId!: Types.ObjectId;

  /** When the match was created — also used to order the match list. */
  @Prop({ type: Date, required: true })
  matchedAt!: Date;

  createdAt!: Date;

  updatedAt!: Date;
}

export const MatchSchema = SchemaFactory.createForClass(Match);

// One match per pair, forever (the canonical ordering makes this A↔B == B↔A).
MatchSchema.index({ userAId: 1, userBId: 1 }, { unique: true });

// Listing a user's active matches touches both sides of the pair.
MatchSchema.index({ userAId: 1, status: 1 });
MatchSchema.index({ userBId: 1, status: 1 });
