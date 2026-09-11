import { ApiProperty } from '@nestjs/swagger';
import { MAX_AGE, MIN_AGE } from '../../../common/constants/age.constants';
import { Gender } from '../../../common/enums/gender.enum';
import { RelationshipIntent } from '../../../common/enums/relationship-intent.enum';

/** Preferences payload returned by `GET` and `PATCH /api/v1/preferences`. */
export class PreferencesResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Owner user id' })
  userId!: string;

  @ApiProperty({ enum: Gender, isArray: true, example: [Gender.Woman] })
  preferredGenders!: Gender[];

  @ApiProperty({ example: 22, minimum: MIN_AGE, maximum: MAX_AGE })
  ageMin!: number;

  @ApiProperty({ example: 29, minimum: MIN_AGE, maximum: MAX_AGE })
  ageMax!: number;

  @ApiProperty({ enum: RelationshipIntent, example: RelationshipIntent.DatingRomance })
  relationshipIntent!: RelationshipIntent;

  @ApiProperty({ example: '2026-09-11T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-11T00:00:00.000Z' })
  updatedAt!: string;
}
