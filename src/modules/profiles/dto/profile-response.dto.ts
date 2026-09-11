import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MAX_AGE, MIN_AGE } from '../../../common/constants/age.constants';
import { Gender } from '../../../common/enums/gender.enum';
import { Profession } from '../../../common/enums/profession.enum';

/** Profile payload returned by `GET` and `PATCH /api/v1/profile`. */
export class ProfileResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Owner user id' })
  userId!: string;

  @ApiProperty({ example: 'Maya' })
  name!: string;

  @ApiProperty({ example: 24, minimum: MIN_AGE, maximum: MAX_AGE })
  age!: number;

  @ApiProperty({ enum: Gender, example: Gender.Woman })
  gender!: Gender;

  @ApiProperty({ enum: Profession, example: Profession.DesignCreative })
  profession!: Profession;

  @ApiPropertyOptional({ example: 'Design Lead @ Studio', nullable: true })
  education?: string;

  @ApiPropertyOptional({ example: 'https://cdn.example.com/photos/maya.jpg', nullable: true })
  photoUrl?: string;

  @ApiProperty({ example: 'Coffee snob, indie music lover & weekend cyclist' })
  bio!: string;

  @ApiProperty({ example: '2026-09-11T00:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({ example: '2026-09-11T00:00:00.000Z' })
  updatedAt!: string;
}
