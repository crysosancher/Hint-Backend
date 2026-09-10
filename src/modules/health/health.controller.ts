import { Controller, Get } from '@nestjs/common';
import { InjectConnection } from '@nestjs/mongoose';
import type { Connection } from 'mongoose';
import { RedisService } from '../../infra/redis/redis.service';

interface LivenessResponse {
  status: 'ok';
  uptime: number;
  timestamp: string;
}

interface ReadinessResponse {
  status: 'ok' | 'degraded';
  checks: {
    mongodb: boolean;
    redis: boolean;
  };
}

/**
 * Health endpoints are intentionally excluded from the global API prefix so
 * orchestrators (Docker, k8s) can probe `/health` directly.
 */
@Controller('health')
export class HealthController {
  constructor(
    @InjectConnection() private readonly mongo: Connection,
    private readonly redis: RedisService,
  ) {}

  /** Cheap liveness probe: the process is up and the event loop is responsive. */
  @Get()
  liveness(): LivenessResponse {
    return {
      status: 'ok',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness probe: downstream dependencies answer. */
  @Get('ready')
  async readiness(): Promise<ReadinessResponse> {
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
