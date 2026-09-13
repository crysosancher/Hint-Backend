import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Nearby Mode state.
 *
 * Derived from the presence key's existence in Redis: `active` means the key
 * is present (and still has a TTL), `inactive` means it is missing or has
 * already expired.
 */
export enum NearbyStatus {
  Active = 'active',
  Inactive = 'inactive',
}

/** Payload returned by the Nearby Mode (presence) endpoints. */
export class NearbySessionResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Owner user id' })
  userId!: string;

  @ApiProperty({ enum: NearbyStatus, example: NearbyStatus.Active })
  status!: NearbyStatus;

  @ApiPropertyOptional({
    example: '2026-09-12T09:00:00.000Z',
    description: 'When Nearby Mode was (re)activated',
  })
  startedAt?: string;

  @ApiPropertyOptional({
    example: '2026-09-12T09:30:00.000Z',
    description: 'When Nearby Mode expires automatically',
  })
  expiresAt?: string;

  @ApiPropertyOptional({
    example: 1800,
    description: 'Seconds remaining until the session expires',
  })
  ttlSeconds?: number;
}
