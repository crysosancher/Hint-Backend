import { ApiProperty } from '@nestjs/swagger';
import { MatchStatus } from '../../../common/enums/match-status.enum';
import { SafeProfileDto } from '../../profiles/dto/safe-profile.dto';

/** A persistent mutual match. */
export class MatchResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ enum: MatchStatus, example: MatchStatus.Active })
  status!: MatchStatus;

  @ApiProperty({
    example: '665f1b2c3d4e5f6a7b8c9d0e',
    description: 'The interest whose acceptance created this match',
  })
  interestId!: string;

  @ApiProperty({
    example: '2026-09-12T09:00:00.000Z',
    description: 'When the match was created',
  })
  matchedAt!: string;
}

/** A match together with the other participant, for the match list. */
export class MatchListItemDto {
  @ApiProperty({ type: MatchResponseDto })
  match!: MatchResponseDto;

  @ApiProperty({ type: SafeProfileDto, description: 'The other participant' })
  user!: SafeProfileDto;
}
