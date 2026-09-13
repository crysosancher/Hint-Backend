import { ApiProperty } from '@nestjs/swagger';
import { SafeProfileDto } from '../../profiles/dto/safe-profile.dto';

/**
 * A discoverable user: their safe profile plus **coarse** proximity.
 *
 * `distanceMeters` is deliberately bucketed (see `coarsenDistance`) so repeated
 * reads cannot be used to trilaterate another user's position, and exact
 * coordinates are never included anywhere in this payload.
 */
export class NearbyProfileDto extends SafeProfileDto {
  @ApiProperty({
    example: 50,
    description: 'Coarse distance in metres, rounded down to the nearest bucket (never exact)',
  })
  distanceMeters!: number;
}
