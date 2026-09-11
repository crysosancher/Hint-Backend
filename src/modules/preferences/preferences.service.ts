import { BadRequestException, Injectable, InternalServerErrorException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { DEFAULT_AGE_MAX, DEFAULT_AGE_MIN } from '../../common/constants/age.constants';
import { PreferencesResponseDto } from './dto/preferences-response.dto';
import { UpsertPreferencesDto } from './dto/upsert-preferences.dto';
import { Preference, PreferenceDocument } from './preference.schema';

/**
 * Create/read access for matching preferences.
 *
 * Because every field is optional, the incoming age bounds are merged with the
 * stored (or default) values before the `ageMin <= ageMax` invariant is
 * checked, so a partial update can never leave an inverted range behind.
 */
@Injectable()
export class PreferencesService {
  constructor(
    @InjectModel(Preference.name) private readonly preferenceModel: Model<PreferenceDocument>,
  ) {}

  async upsert(userId: string, dto: UpsertPreferencesDto): Promise<PreferencesResponseDto> {
    const existing = await this.preferenceModel.findOne({ userId }).exec();

    const ageMin = dto.ageMin ?? existing?.ageMin ?? DEFAULT_AGE_MIN;
    const ageMax = dto.ageMax ?? existing?.ageMax ?? DEFAULT_AGE_MAX;
    if (ageMin > ageMax) {
      throw new BadRequestException('ageMin must be less than or equal to ageMax');
    }

    const preference = await this.preferenceModel
      .findOneAndUpdate(
        { userId },
        { $set: { ...dto } },
        { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true },
      )
      .exec();

    if (!preference) {
      throw new InternalServerErrorException('Failed to persist preferences');
    }

    return this.toResponse(preference);
  }

  async get(userId: string): Promise<PreferencesResponseDto | null> {
    const preference = await this.preferenceModel.findOne({ userId }).exec();
    return preference ? this.toResponse(preference) : null;
  }

  private toResponse(preference: PreferenceDocument): PreferencesResponseDto {
    return {
      id: preference._id.toString(),
      userId: preference.userId.toString(),
      preferredGenders: preference.preferredGenders,
      ageMin: preference.ageMin,
      ageMax: preference.ageMax,
      relationshipIntent: preference.relationshipIntent,
      createdAt: preference.createdAt.toISOString(),
      updatedAt: preference.updatedAt.toISOString(),
    };
  }
}
