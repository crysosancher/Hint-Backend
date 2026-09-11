import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import {
  DEFAULT_AGE_MAX,
  DEFAULT_AGE_MIN,
  MAX_AGE,
  MIN_AGE,
} from '../../common/constants/age.constants';
import { Gender } from '../../common/enums/gender.enum';
import { RelationshipIntent } from '../../common/enums/relationship-intent.enum';

export type PreferenceDocument = HydratedDocument<Preference>;

/**
 * Matching preferences ("Proximity & Intent").
 *
 * One document per account, keyed by a unique `userId`. Consumed later by the
 * Discovery module to filter compatible users.
 */
@Schema({ timestamps: true, collection: 'preferences' })
export class Preference {
  _id!: Types.ObjectId;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  /** Genders the user is open to. Empty means "no preference". */
  @Prop({ type: [String], enum: Gender, default: [] })
  preferredGenders!: Gender[];

  @Prop({ type: Number, min: MIN_AGE, max: MAX_AGE, default: DEFAULT_AGE_MIN })
  ageMin!: number;

  @Prop({ type: Number, min: MIN_AGE, max: MAX_AGE, default: DEFAULT_AGE_MAX })
  ageMax!: number;

  @Prop({
    type: String,
    enum: RelationshipIntent,
    default: RelationshipIntent.DatingRomance,
  })
  relationshipIntent!: RelationshipIntent;

  createdAt!: Date;

  updatedAt!: Date;
}

export const PreferenceSchema = SchemaFactory.createForClass(Preference);
