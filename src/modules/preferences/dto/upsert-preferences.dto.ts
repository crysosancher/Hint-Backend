import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_AGE, MIN_AGE } from '../../../common/constants/age.constants';
import { Gender } from '../../../common/enums/gender.enum';
import { RelationshipIntent } from '../../../common/enums/relationship-intent.enum';

/**
 * Body for `PATCH /api/v1/preferences` — creates or updates the caller's
 * matching preferences. Every field is optional, so the client can send a
 * partial update; `ageMin <= ageMax` is enforced by the service once the
 * incoming values are merged with what is already stored.
 */
export class UpsertPreferencesDto {
  @ApiPropertyOptional({
    enum: Gender,
    isArray: true,
    example: [Gender.Woman, Gender.NonBinary],
    description: 'Genders the user is open to; omit or send [] for no preference',
  })
  @IsOptional()
  @IsArray()
  @IsEnum(Gender, { each: true })
  preferredGenders?: Gender[];

  @ApiPropertyOptional({ example: 22, minimum: MIN_AGE, maximum: MAX_AGE })
  @IsOptional()
  @IsInt()
  @Min(MIN_AGE)
  @Max(MAX_AGE)
  ageMin?: number;

  @ApiPropertyOptional({ example: 29, minimum: MIN_AGE, maximum: MAX_AGE })
  @IsOptional()
  @IsInt()
  @Min(MIN_AGE)
  @Max(MAX_AGE)
  ageMax?: number;

  @ApiPropertyOptional({ enum: RelationshipIntent, example: RelationshipIntent.DatingRomance })
  @IsOptional()
  @IsEnum(RelationshipIntent)
  relationshipIntent?: RelationshipIntent;
}
