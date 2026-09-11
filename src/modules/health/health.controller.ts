import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Connection } from 'mongoose';
import { RedisService } from '../../infra/redis/redis.service';
import { LivenessResponseDto, ReadinessResponseDto } from './dto/health-response.dto';

/**
 * Health endpoints are intentionally excluded from the global API prefix so
 * orchestrators (Docker, k8s) can probe `/health` directly.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly redis: RedisService,
  ) {}

  /** Cheap liveness probe: the process is up and the event loop is responsive. */
  @Get()
  @ApiOperation({
    summary: 'Liveness probe',
    description:
      'Returns 200 as soon as the process is running. Does not touch downstream ' +
      'dependencies, so it stays fast and safe for frequent polling.',
  })
  @ApiOkResponse({ type: LivenessResponseDto })
  liveness(): LivenessResponseDto {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness probe: downstream dependencies answer. */
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description:
      'Pings MongoDB and Redis. Returns `ok` when both answer, `degraded` otherwise. ' +
      'Always responds 200 so the caller can read the per-dependency breakdown.',
  })
  @ApiOkResponse({
    type: ReadinessResponseDto,
    description: 'Dependency breakdown; `status` is `ok` or `degraded`',
  })
  async readiness(): Promise<ReadinessResponseDto> {
    const [mongodb, redis] = await Promise.all([this.checkMongo(), this.checkRedis()]);

    return {
      status: mongodb && redis ? 'ok' : 'degraded',
      checks: { mongodb, redis },
    };
  }

  private async checkMongo(): Promise<boolean> {
    try {
      const db = this.mongo.db;
      if (!db) return false;
      await db.admin().ping();
      return true;
    } catch {
      return false;
    }
  }

  private async checkRedis(): Promise<boolean> {
    try {
      return await this.redis.ping();
    } catch {
      return false;
    }
  }
}
