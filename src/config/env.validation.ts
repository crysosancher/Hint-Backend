import { plainToInstance, Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export enum NodeEnv {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

/**
 * Schema for the raw environment variables.
 *
 * The class-validator metadata is reused to fail fast at boot time: if a
 * required variable is missing, or a numeric one is not a number, the app
 * refuses to start with a descriptive error instead of failing later at the
 * first database call.
 */
export class EnvironmentVariables {
  @IsEnum(NodeEnv)
  NODE_ENV: NodeEnv = NodeEnv.Development;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT = 3000;

  @IsString()
  API_PREFIX = 'api/v1';

  @IsString()
  MONGODB_URI!: string;

  @IsString()
  REDIS_HOST = 'localhost';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  REDIS_PORT = 6379;

  @IsOptional()
  @IsString()
  REDIS_PASSWORD?: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  REDIS_DB = 0;

  @IsString()
  JWT_ACCESS_SECRET!: string;

  @IsString()
  JWT_ACCESS_TTL = '15m';

  @IsString()
  JWT_REFRESH_SECRET!: string;

  @IsString()
  JWT_REFRESH_TTL = '30d';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  NEARBY_SESSION_TTL_MINUTES = 30;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  NEARBY_RADIUS_METERS = 250;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOCATION_MAX_AGE_SECONDS = 120;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  LOCATION_MAX_ACCURACY_METERS = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_TTL_SECONDS = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  THROTTLE_LIMIT = 100;

  @IsString()
  QUEUE_PREFIX = 'hint';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  QUEUE_CONCURRENCY = 5;

  /** 'true'/'false' (leniently parsed in configuration.ts). */
  @IsOptional()
  @IsString()
  SWAGGER_ENABLED?: string;

  @IsString()
  SWAGGER_PATH = 'docs';
}

export function validateEnvironment(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true,
    exposeDefaultValues: true,
  });

  const errors = validateSync(validated, {
    skipMissingProperties: false,
    whitelist: false,
  });

  if (errors.length > 0) {
    const details = errors
      .map((error) => Object.values(error.constraints ?? {}).join(', '))
      .join('\n  - ');
    throw new Error(`Invalid environment configuration:\n  - ${details}`);
  }

  return validated;
}
