import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';
import { MAX_AGE, MIN_AGE } from '../../common/constants/age.constants';
import { Gender } from '../../common/enums/gender.enum';
import { Profession } from '../../common/enums/profession.enum';

export type ProfileDocument = HydratedDocument<Profile>;

/**
 * A user's public profile (the "Create Your Aura" form).
 *
 * One profile per account, keyed by a unique `userId` so the create/update
 * endpoint can upsert without a separate existence check. Profile reads never
 * touch the credentials on the `users` collection.
 */
@Schema({ timestamps: true, collection: 'profiles' })
export class Profile {
  _id!: Types.ObjectId;

  /** Owner. Unique: a user has exactly one profile. */
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, unique: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, trim: true, maxlength: 50 })
  name!: string;

  @Prop({ required: true, min: MIN_AGE, max: MAX_AGE })
  age!: number;

  @Prop({ type: String, enum: Gender, required: true })
  gender!: Gender;

  @Prop({ type: String, enum: Profession, required: true })
  profession!: Profession;

  /** Free-text company / school / headline (the "& Education" half of the field). */
  @Prop({ type: String, trim: true, maxlength: 100 })
  education?: string;

  /** Photo URL for MVP; real uploads/streams arrive in a later phase. */
  @Prop({ type: String, trim: true, maxlength: 500 })
  photoUrl?: string;

  @Prop({ type: String, trim: true, maxlength: 80, default: '' })
  bio!: string;

  createdAt!: Date;

  updatedAt!: Date;
}

export const ProfileSchema = SchemaFactory.createForClass(Profile);
