import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { InterestStatus } from '../../common/enums/interest-status.enum';

export type InterestDocument = HydratedDocument<Interest>;

/**
 * An interest sent from one user toward another.
 *
 * Created only while both users are discoverable and within 250 m, and only ever
 * acted on by its receiver. `expiresAt` bounds how long the interest stays
 * actionable (the background sweep arrives with the Phase 4 queues; until then
 * expiry is applied lazily on read/respond).
 */
@Schema({ timestamps: true, collection: 'interests' })
export class Interest {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  senderId!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  receiverId!: Types.ObjectId;

  @Prop({ type: String, enum: InterestStatus, default: InterestStatus.Sent })
  status!: InterestStatus;

  /** After this instant the interest can no longer be accepted or ignored. */
  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  /** Set once the receiver accepts or ignores the interest. */
  @Prop({ type: Date })
  respondedAt?: Date;

  createdAt!: Date;

  updatedAt!: Date;
}

export const InterestSchema = SchemaFactory.createForClass(Interest);

// Inbox/outbox reads are always "my id + status, newest first".
InterestSchema.index({ receiverId: 1, status: 1, createdAt: -1 });
InterestSchema.index({ senderId: 1, status: 1, createdAt: -1 });

// At most one *pending* interest per direction. A partial index means resolved
// interests (accepted/ignored/expired) don't block a later one.
InterestSchema.index(
  { senderId: 1, receiverId: 1 },
  { unique: true, partialFilterExpression: { status: InterestStatus.Sent } },
);

// Phase 4 expiry sweep.
InterestSchema.index({ expiresAt: 1 });
