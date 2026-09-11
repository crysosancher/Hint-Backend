import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User, UserDocument } from './user.schema';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
}

/**
 * Data access for the `users` collection.
 *
 * Keeps Mongoose specifics out of the Auth module and centralises email
 * normalisation so register/login always compare the same canonical form.
 */
@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  /** Canonical form used for storage and lookups (case/whitespace insensitive). */
  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async create(input: CreateUserInput): Promise<UserDocument> {
    const created = new this.userModel({
      email: this.normalizeEmail(input.email),
      passwordHash: input.passwordHash,
    });

    return created.save();
  }

  /**
   * Looks a user up by email. The password hash is excluded from the projection
   * by default; pass `{ includePassword: true }` for the login path.
   */
  async findByEmail(
    email: string,
    options: { includePassword?: boolean } = {},
  ): Promise<UserDocument | null> {
    const query = this.userModel.findOne({ email: this.normalizeEmail(email) });
    if (options.includePassword) query.select('+passwordHash');

    return query.exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async existsByEmail(email: string): Promise<boolean> {
    const found = await this.userModel.exists({ email: this.normalizeEmail(email) });
    return found !== null;
  }
}
