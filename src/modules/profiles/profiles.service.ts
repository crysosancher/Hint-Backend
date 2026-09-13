import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { SafeProfileDto } from './dto/safe-profile.dto';
import { UpsertProfileDto } from './dto/upsert-profile.dto';
import { Profile, ProfileDocument } from './profile.schema';

/**
 * Create/read access for profiles.
 *
 * Updates are keyed on the unique `userId`, so a single `findOneAndUpdate`
 * upsert serves both the "create" and "edit" flows from the setup screen.
 */
@Injectable()
export class ProfilesService {
  constructor(@InjectModel(Profile.name) private readonly profileModel: Model<ProfileDocument>) {}

  async upsert(userId: string, dto: UpsertProfileDto): Promise<ProfileResponseDto> {
    const profile = await this.profileModel
      .findOneAndUpdate(
        { userId },
        { $set: { ...dto } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!profile) {
      throw new InternalServerErrorException('Failed to persist profile');
    }

    return this.toResponse(profile);
  }

  async get(userId: string): Promise<ProfileResponseDto | null> {
    const profile = await this.profileModel.findOne({ userId }).exec();
    return profile ? this.toResponse(profile) : null;
  }

  /**
   * Safe (third-party-visible) profiles for a batch of users, keyed by user id.
   *
   * Used by discovery, interests and matches, which all need to attach a
   * presentable profile to other users without exposing anything private. Users
   * without a profile are simply absent from the returned map — which is also
   * how discovery filters out candidates who never finished setup.
   */
  async findManySafeProfiles(userIds: string[]): Promise<Map<string, SafeProfileDto>> {
    if (userIds.length === 0) return new Map();

    const profiles = await this.profileModel.find({ userId: { $in: userIds } }).exec();

    return new Map(profiles.map((profile) => [profile.userId.toString(), this.toSafeProfile(profile)]));
  }

  private toSafeProfile(profile: ProfileDocument): SafeProfileDto {
    return {
      userId: profile.userId.toString(),
      name: profile.name,
      age: profile.age,
      gender: profile.gender,
      profession: profile.profession,
      education: profile.education,
      photoUrl: profile.photoUrl,
      bio: profile.bio,
    };
  }

  private toResponse(profile: ProfileDocument): ProfileResponseDto {
    return {
      id: profile._id.toString(),
      userId: profile.userId.toString(),
      name: profile.name,
      age: profile.age,
      gender: profile.gender,
      profession: profile.profession,
      education: profile.education,
      photoUrl: profile.photoUrl,
      bio: profile.bio,
      createdAt: profile.createdAt.toISOString(),
      updatedAt: profile.updatedAt.toISOString(),
    };
  }
}
