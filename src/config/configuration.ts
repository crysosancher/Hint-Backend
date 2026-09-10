/**
 * Strongly-typed application configuration.
 *
 * This factory is registered with `ConfigModule.forRoot({ load: [configuration] })`
 * and read back through `ConfigService<AppConfiguration, true>` so that
 * `config.get('app.port', { infer: true })` is fully typed.
 *
 * Values are sourced from environment variables that were already validated by
 * `validateEnvironment` (see ./env.validation.ts).
 */
export interface AppConfiguration {
  app: {
    nodeEnv: string;
    port: number;
    apiPrefix: string;
  };
  mongo: {
    uri: string;
  };
  redis: {
    host: string;
    port: number;
    password?: string;
    db: number;
  };
  jwt: {
    accessSecret: string;
    accessTtl: string;
    refreshSecret: string;
    refreshTtl: string;
  };
  nearby: {
    sessionTtlMinutes: number;
    radiusMeters: number;
    locationMaxAgeSeconds: number;
    locationMaxAccuracyMeters: number;
  };
  throttle: {
    ttlSeconds: number;
    limit: number;
  };
  queue: {
    prefix: string;
    concurrency: number;
  };
}

const toInt = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

export default (): AppConfiguration => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: toInt(process.env.PORT, 3000),
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
  },
  mongo: {
    uri: process.env.MONGODB_URI ?? 'mongodb://localhost:27017/hint',
  },
  redis: {
    host: process.env.REDIS_HOST ?? 'localhost',
    port: toInt(process.env.REDIS_PORT, 6379),
    password: process.env.REDIS_PASSWORD || undefined,
    db: toInt(process.env.REDIS_DB, 0),
  },
  jwt: {
    accessSecret: process.env.JWT_ACCESS_SECRET ?? '',
    accessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    refreshSecret: process.env.JWT_REFRESH_SECRET ?? '',
    refreshTtl: process.env.JWT_REFRESH_TTL ?? '30d',
  },
  nearby: {
    sessionTtlMinutes: toInt(process.env.NEARBY_SESSION_TTL_MINUTES, 30),
    radiusMeters: toInt(process.env.NEARBY_RADIUS_METERS, 250),
    locationMaxAgeSeconds: toInt(process.env.LOCATION_MAX_AGE_SECONDS, 120),
    locationMaxAccuracyMeters: toInt(process.env.LOCATION_MAX_ACCURACY_METERS, 100),
  },
  throttle: {
    ttlSeconds: toInt(process.env.THROTTLE_TTL_SECONDS, 60),
    limit: toInt(process.env.THROTTLE_LIMIT, 100),
  },
  queue: {
    prefix: process.env.QUEUE_PREFIX ?? 'hint',
    concurrency: toInt(process.env.QUEUE_CONCURRENCY, 5),
  },
});
