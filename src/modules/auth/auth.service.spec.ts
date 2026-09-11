import { BadRequestException, ConflictException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Types } from 'mongoose';
import type { AppConfiguration } from '../../config/configuration';
import { PasswordService } from '../../common/password/password.service';
import { RedisService } from '../../infra/redis/redis.service';
import { UserDocument, UserStatus } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

/** Minimal in-memory stand-in for UsersService. */
class FakeUsersService {
  readonly users = new Map<string, UserDocument>();

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  async existsByEmail(email: string): Promise<boolean> {
    return this.users.has(this.normalizeEmail(email));
  }

  async create(input: { email: string; passwordHash: string }): Promise<UserDocument> {
    const email = this.normalizeEmail(input.email);
    const user = {
      _id: new Types.ObjectId(),
      email,
      passwordHash: input.passwordHash,
      status: UserStatus.Active,
      createdAt: new Date(),
    } as unknown as UserDocument;

    this.users.set(email, user);
    return user;
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.users.get(this.normalizeEmail(email)) ?? null;
  }

  async findById(id: string): Promise<UserDocument | null> {
    for (const user of this.users.values()) {
      if (user._id.toString() === id) return user;
    }
    return null;
  }
}

/** In-memory stand-in for the shared Redis client. */
class FakeRedis {
  readonly store = new Map<string, string>();

  key(...parts: (string | number)[]): string {
    return ['hint', ...parts].join(':');
  }

  async del(...keys: string[]): Promise<number> {
    let removed = 0;
    for (const key of keys) if (this.store.delete(key)) removed += 1;
    return removed;
  }

  readonly client = {
    get: async (key: string): Promise<string | null> => this.store.get(key) ?? null,
    set: async (key: string, value: string): Promise<'OK'> => {
      this.store.set(key, value);
      return 'OK';
    },
  };
}

const CONFIG: Record<string, string> = {
  'jwt.accessSecret': 'test-access-secret',
  'jwt.accessTtl': '15m',
  'jwt.refreshSecret': 'test-refresh-secret',
  'jwt.refreshTtl': '30d',
};

const configFake = {
  get: (key: string): string | undefined => CONFIG[key],
};

const registerDto = {
  email: 'ada@example.com',
  password: 'Sunshine123',
  confirmPassword: 'Sunshine123',
};

describe('AuthService', () => {
  let service: AuthService;
  let users: FakeUsersService;
  let redis: FakeRedis;

  beforeEach(() => {
    users = new FakeUsersService();
    redis = new FakeRedis();
    service = new AuthService(
      configFake as unknown as ConfigService<AppConfiguration, true>,
      new JwtService(),
      users as unknown as UsersService,
      new PasswordService(),
      redis as unknown as RedisService,
    );
  });

  describe('register', () => {
    it('creates the account and returns a signed token pair', async () => {
      const result = await service.register({ ...registerDto });

      expect(result.user.email).toBe('ada@example.com');
      expect(result.user.status).toBe(UserStatus.Active);
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(users.users.has('ada@example.com')).toBe(true);

      const jwt = new JwtService();
      const access = jwt.verify(result.accessToken, { secret: CONFIG['jwt.accessSecret'] });
      expect(access).toMatchObject({ email: 'ada@example.com', type: 'access' });
      const refresh = jwt.verify<{ type: string }>(result.refreshToken, {
        secret: CONFIG['jwt.refreshSecret'],
      });
      expect(refresh.type).toBe('refresh');
      // The refresh token is tracked in Redis so it can be rotated.
      expect(redis.store.size).toBe(1);
    });

    it('rejects mismatched passwords', async () => {
      await expect(
        service.register({ ...registerDto, confirmPassword: 'Different123' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a duplicate email', async () => {
      await service.register({ ...registerDto });

      await expect(service.register({ ...registerDto })).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    beforeEach(async () => {
      await service.register({ ...registerDto });
    });

    it('returns tokens for correct credentials', async () => {
      const result = await service.login({ email: 'Ada@Example.com', password: 'Sunshine123' });

      expect(result.user.email).toBe('ada@example.com');
      expect(typeof result.accessToken).toBe('string');
    });

    it('rejects a wrong password', async () => {
      await expect(
        service.login({ email: 'ada@example.com', password: 'Nope12345' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('rejects an unknown email with the same error', async () => {
      await expect(
        service.login({ email: 'nobody@example.com', password: 'Sunshine123' }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates the token and prevents replay of the old token', async () => {
      const issued = await service.register({ ...registerDto });

      const rotated = await service.refresh({ refreshToken: issued.refreshToken });

      expect(rotated.refreshToken).not.toBe(issued.refreshToken);
      await expect(service.refresh({ refreshToken: issued.refreshToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a token that is not a refresh token', async () => {
      const issued = await service.register({ ...registerDto });

      await expect(service.refresh({ refreshToken: issued.accessToken })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a malformed token', async () => {
      await expect(service.refresh({ refreshToken: 'not-a-jwt' })).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
  });
});
