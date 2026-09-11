import { ApiProperty } from '@nestjs/swagger';

/** Payload returned by `GET /health`. */
export class LivenessResponseDto {
  @ApiProperty({ example: 'ok', description: 'Always "ok" while the process is alive' })
  status!: string;

  @ApiProperty({ example: 42, description: 'Process uptime in seconds' })
  uptime!: number;

  @ApiProperty({
    example: '2026-09-11T00:00:00.000Z',
    description: 'Server time when the probe was answered (ISO 8601)',
  })
  timestamp!: string;
}

/** Per-dependency readiness flags. */
export class ReadinessChecksDto {
  @ApiProperty({ example: true, description: 'MongoDB answered an admin ping' })
  mongodb!: boolean;

  @ApiProperty({ example: true, description: 'Redis answered PING' })
  redis!: boolean;
}

/** Payload returned by `GET /health/ready`. */
export class ReadinessResponseDto {
  @ApiProperty({
    enum: ['ok', 'degraded'],
    example: 'ok',
    description: '"ok" when every dependency is reachable, otherwise "degraded"',
  })
  status!: string;

  @ApiProperty({ type: ReadinessChecksDto })
  checks!: ReadinessChecksDto;
}
