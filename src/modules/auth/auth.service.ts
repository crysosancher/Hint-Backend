import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService, JwtSignOptions } from '@nestjs/jwt';
import { createHash, randomUUID } from 'node:crypto';
import type { AppConfiguration } from '../../config/configuration';
import { PasswordService } from '../../common/password/password.service';
import { RedisService } from '../../infra/redis/redis.service';
import { UserDocument, UserStatus } from '../users/user.schema';
import { UsersService } from '../users/users.service';
import { AuthResponseDto, SafeUserDto } from './dto/auth-response.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

/** Claims carried by the short-lived access token. */
interface AccessTokenPayload {
  sub: string;
  email: string;
  type: 'access';
}

/** Claims carried by the long-lived refresh token (`jti` enables rotation). */
interface RefreshTokenPayload {
  sub: string;
  type: 'refresh';
  jti: string;
}

/**
 * A valid scrypt hash verified when the email is unknown, so login takes the
 * same time whether or not an account exists (no user enumeration by timing).
 */
const TIMING_DUMMY_HASH =
  'scrypt$16384$8$1$un27uuPMSYGr/4RpXINHeg==$3WMAU3Kj6PUhA4Lt5pzsGmDheWiHAaYQASga94xT5JphGzDU2nzBplfpIZsTyD45LJ9JrvkWd2gsLoZZ5bVNNQ==';

const INVALID_CREDENTIALS = 'Invalid email or password';

/**
 * Registration, authentication and token issuance.
 *
 * Access tokens are short-lived and stateless. Refresh tokens are long-lived,
 * single-use and tracked (hashed) in Redis so they can be rotated on every
 * refresh and revoked before expiry.
 */
@Injectable()
export class AuthService {
  constructor(
    private readonly config: ConfigService<AppConfiguration, true>,
    private readonly jwt: JwtService,
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly redis: RedisService,
  ) {}

  /** Creates an account and logs the user in with a fresh token pair. */
  async register(dto: RegisterDto): Promise<AuthResponseDto> {
    if (dto.password !== dto.confirmPassword) {
      throw new BadRequestException('password and confirmPassword do not match');
    }

    const email = this.users.normalizeEmail(dto.email);
    if (await this.users.existsByEmail(email)) {
      throw new ConflictException('An account with this email already exists');
    }

    const passwordHash = await this.passwords.hash(dto.password);

    try {
      const user = await this.users.create({ email, passwordHash });
      return await this.issueTokens(user);
    } catch (error) {
      // Unique-index race: two concurrent registrations for the same email.
      if (this.isDuplicateKeyError(error)) {
        throw new ConflictException('An account with this email already exists');
      }
      throw error;
    }
  }

  /** Verifies credentials and returns a fresh token pair. */
  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const user = await this.users.findByEmail(dto.email, { includePassword: true });
    const passwordHash = user?.passwordHash ?? TIMING_DUMMY_HASH;
    const passwordMatches = await this.passwords.verify(dto.password, passwordHash);

    if (!user || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS);
    }
    if (user.status !== UserStatus.Active) {
      throw new UnauthorizedException('This account is not active');
    }

    return this.issueTokens(user);
  }

  /** Rotates a refresh token: the presented token is consumed and replaced. */
  async refresh(dto: RefreshDto): Promise<AuthResponseDto> {
    const payload = await this.verifyRefreshToken(dto.refreshToken);

    const key = this.refreshKey(payload.sub, payload.jti);
    const stored = await this.redis.client.get(key);
    if (!stored || stored !== this.hashToken(dto.refreshToken)) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Single use: consume the old token before minting the new pair.
    await this.redis.del(key);

    const user = await this.users.findById(payload.sub);
    if (!user || user.status !== UserStatus.Active) {
      throw new UnauthorizedException('This account is not active');
    }

    return this.issueTokens(user);
  }

  private async issueTokens(user: UserDocument): Promise<AuthResponseDto> {
    const userId = user._id.toString();

    const accessPayload: AccessTokenPayload = { sub: userId, email: user.email, type: 'access' };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: this.config.get('jwt.accessSecret', { infer: true }),
      expiresIn: this.config.get('jwt.accessTtl', { infer: true }) as JwtSignOptions['expiresIn'],
    });

    const jti = randomUUID();
    const refreshPayload: RefreshTokenPayload = { sub: userId, type: 'refresh', jti };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: this.config.get('jwt.refreshSecret', { infer: true }),
      expiresIn: this.config.get('jwt.refreshTtl', { infer: true }) as JwtSignOptions['expiresIn'],
    });

    await this.redis.client.set(
      this.refreshKey(userId, jti),
      this.hashToken(refreshToken),
      'EX',
      this.refreshTtlSeconds(refreshToken),
    );

    return { user: this.toSafeUser(user), accessToken, refreshToken };
  }

  private async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    try {
      const payload = await this.jwt.verifyAsync<RefreshTokenPayload>(token, {
        secret: this.config.get('jwt.refreshSecret', { infer: true }),
      });

      if (payload.type !== 'refresh' || !payload.sub || !payload.jti) {
        throw new Error('Unexpected refresh token payload');
      }

      return payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }
  }

  /** Redis key holding the hash of an issued refresh token. */
  private refreshKey(userId: string, jti: string): string {
    return this.redis.key('auth', 'refresh', userId, jti);
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private refreshTtlSeconds(token: string): number {
    const decoded = this.jwt.decode<{ exp?: number }>(token);
    if (decoded?.exp) {
      return Math.max(decoded.exp - Math.floor(Date.now() / 1000), 1);
    }
    return 60;
  }

  private toSafeUser(user: UserDocument): SafeUserDto {
    return {
      id: user._id.toString(),
      email: user.email,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
    };
  }

  private isDuplicateKeyError(error: unknown): boolean {
    return (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      (error as { code?: number }).code === 11000
    );
  }
}
