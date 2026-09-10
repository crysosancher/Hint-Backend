import { NodeEnv, validateEnvironment } from './env.validation';

describe('validateEnvironment', () => {
  const required = {
    MONGODB_URI: 'mongodb://localhost:27017/hint',
    JWT_ACCESS_SECRET: 'access-secret',
    JWT_REFRESH_SECRET: 'refresh-secret',
  };

  it('applies defaults for optional variables', () => {
    const env = validateEnvironment({ ...required });

    expect(env.NODE_ENV).toBe(NodeEnv.Development);
    expect(env.PORT).toBe(3000);
    expect(env.API_PREFIX).toBe('api/v1');
    expect(env.REDIS_PORT).toBe(6379);
    expect(env.NEARBY_RADIUS_METERS).toBe(250);
    expect(env.NEARBY_SESSION_TTL_MINUTES).toBe(30);
    expect(env.QUEUE_PREFIX).toBe('hint');
  });

  it('coerces numeric environment strings to numbers', () => {
    const env = validateEnvironment({
      ...required,
      PORT: '8080',
      NEARBY_RADIUS_METERS: '300',
      REDIS_DB: '2',
    });

    expect(env.PORT).toBe(8080);
    expect(env.NEARBY_RADIUS_METERS).toBe(300);
    expect(env.REDIS_DB).toBe(2);
  });

  it('throws when required variables are missing', () => {
    expect(() => validateEnvironment({})).toThrow(/Invalid environment configuration/);
  });

  it('throws when NODE_ENV is not a known value', () => {
    expect(() => validateEnvironment({ ...required, NODE_ENV: 'staging' })).toThrow(
      /Invalid environment configuration/,
    );
  });

  it('throws when a numeric variable is out of range', () => {
    expect(() => validateEnvironment({ ...required, PORT: '0' })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
