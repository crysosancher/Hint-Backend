import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { MAX_AGE, MIN_AGE } from '../../../common/constants/age.constants';
import { Gender } from '../../../common/enums/gender.enum';
import { Profession } from '../../../common/enums/profession.enum';

/**
 * Body for `PATCH /api/v1/profile` — creates or updates the caller's profile.
 *
 * The four core fields mirror the required inputs on the "Create Your Aura"
 * screen; the rest are optional.
 */
export class UpsertProfileDto {
  @ApiProperty({ example: 'Maya', minLength: 1, maxLength: 50, description: 'First name' })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: 24, minimum: MIN_AGE, maximum: MAX_AGE })
  @IsInt()
  @Min(MIN_AGE)
  @Max(MAX_AGE)
  age!: number;

  @ApiProperty({ enum: Gender, example: Gender.Woman })
  @IsEnum(Gender)
  gender!: Gender;

  @ApiProperty({ enum: Profession, example: Profession.DesignCreative })
  @IsEnum(Profession)
  profession!: Profession;

  @ApiPropertyOptional({ example: 'Design Lead @ Studio', maxLength: 100 })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  education?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/photos/maya.jpg', maxLength: 500 })
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  @MaxLength(500)
  photoUrl?: string;

  @ApiPropertyOptional({
    example: 'Coffee snob, indie music lover & weekend cyclist',
    maxLength: 80,
  })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  bio?: string;
}
