import { ApiProperty } from '@nestjs/swagger';

/**
 * The caller's own latest location. Exact coordinates are only ever returned
 * to their owner — discovery (Phase 3) exposes safe profile data and coarse
 * proximity information only.
 */
export class LocationResponseDto {
  @ApiProperty({ example: '665f1b2c3d4e5f6a7b8c9d0e', description: 'Owner user id' })
  userId!: string;

  @ApiProperty({ example: 12.971599 })
  latitude!: number;

  @ApiProperty({ example: 77.594566 })
  longitude!: number;

  @ApiProperty({ example: 12.5, description: 'Reported horizontal accuracy in metres' })
  accuracyMeters!: number;

  @ApiProperty({ example: '2026-09-12T09:00:00.000Z' })
  updatedAt!: string;
}
