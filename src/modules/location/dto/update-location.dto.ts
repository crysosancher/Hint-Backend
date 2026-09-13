import { ApiProperty } from '@nestjs/swagger';
import { IsNumber, Max, Min } from 'class-validator';

/**
 * Body for `POST /api/v1/location` — the caller's latest GPS fix while Nearby
 * Mode is active.
 *
 * The server validates the fix, stores it as a GeoJSON Point and never trusts
 * a client-supplied distance; accuracy is required so discovery can reject
 * fixes that are too imprecise to enforce the 250 m rule.
 */
export class UpdateLocationDto {
  @ApiProperty({
    example: 12.971599,
    minimum: -90,
    maximum: 90,
    description: 'Latitude (WGS84)',
  })
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number;

  @ApiProperty({
    example: 77.594566,
    minimum: -180,
    maximum: 180,
    description: 'Longitude (WGS84)',
  })
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number;

  @ApiProperty({
    example: 12.5,
    minimum: 0,
    description:
      'Reported horizontal accuracy in metres; fixes worse than the configured maximum are rejected',
  })
  @IsNumber()
  @Min(0)
  accuracyMeters!: number;
}
