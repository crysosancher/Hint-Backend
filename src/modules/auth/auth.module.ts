import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { AppConfiguration } from '../../config/configuration';
import { PasswordService } from '../../common/password/password.service';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

/**
 * Auth module: registration, login and refresh-token rotation.
 *
 * `JwtModule` is configured with the access-token secret by default; the
 * refresh token is signed/verified with an explicit secret override inside
 * `AuthService` so the two token types can never be swapped.
 */
@Module({
  imports: [
    UsersModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>) => ({
        secret: config.get('jwt.accessSecret', { infer: true }),
        signOptions: {
          expiresIn: config.get('jwt.accessTtl', { infer: true }),
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [AuthService],
})
export class AuthModule {}
