import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type UserDocument = HydratedDocument<User>;

/**
 * Account lifecycle state.
 *
 * Only `Active` accounts can log in or participate in discovery. `Suspended`
 * and `Deactivated` are reserved for the Moderation module so the field exists
 * before it is needed.
 */
export enum UserStatus {
  Active = 'active',
  Deactivated = 'deactivated',
  Suspended = 'suspended',
}

/**
 * Authentication identity for an account.
 *
 * Profile data (name, age, gender, photo, …) intentionally lives on a separate
 * `Profile` document (later phase) so this collection stays small and the
 * credentials never travel with profile reads.
 *
 * `passwordHash` is marked `select: false`; repositories must opt in with
 * `.select('+passwordHash')` — see `UsersService.findByEmail`.
 */
@Schema({ timestamps: true, collection: 'users' })
export class User {
  _id!: Types.ObjectId;

  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  email!: string;

  @Prop({ required: true, select: false })
  passwordHash!: string;

  @Prop({ type: String, enum: UserStatus, default: UserStatus.Active, index: true })
  status!: UserStatus;

  createdAt!: Date;

  updatedAt!: Date;
}

export const UserSchema = SchemaFactory.createForClass(User);
