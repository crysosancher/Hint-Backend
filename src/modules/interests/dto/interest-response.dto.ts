import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { InterestStatus } from '../../../common/enums/interest-status.enum';
import { MatchResponseDto } from '../../matches/dto/match-response.dto';
import { SafeProfileDto } from '../../profiles/dto/safe-profile.dto';

/** An interest and its lifecycle state. */
export class InterestResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e' })
  id!: string;

  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Who sent the interest' })
  senderId!: string;

  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Who received the interest' })
  receiverId!: string;

  @ApiProperty({ enum: InterestStatus, example: InterestStatus.Sent })
  status!: InterestStatus;

  @ApiProperty({ example: '2026-09-12T09:00:00.000Z', description: 'When it was sent' })
  createdAt!: string;

  @ApiProperty({
    example: '2026-09-19T09:00:00.000Z',
    description: 'When it stops being actionable',
  })
  expiresAt!: string;

  @ApiPropertyOptional({
    example: '2026-09-12T09:05:00.000Z',
    nullable: true,
    description: 'When the receiver accepted or ignored it',
  })
  respondedAt?: string;
}

/** An interest plus the other participant — one inbox/outbox row. */
export class InterestListItemDto {
  @ApiProperty({ type: InterestResponseDto })
  interest!: InterestResponseDto;

  @ApiProperty({ type: SafeProfileDto, description: 'The other participant' })
  user!: SafeProfileDto;
}

/** Result of accepting an interest: the updated interest and the new match. */
export class AcceptInterestResponseDto {
  @ApiProperty({ type: InterestResponseDto })
  interest!: InterestResponseDto;

  @ApiProperty({ type: MatchResponseDto })
  match!: MatchResponseDto;
}
