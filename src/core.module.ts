import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import configuration from './config/configuration';
import { validateEnvironment } from './config/env.validation';
import { DatabaseModule } from './infra/database/database.module';
import { RedisModule } from './infra/redis/redis.module';

/**
 * Shared infrastructure that both the HTTP API process (`main.ts`) and the
 * queue worker process (`worker.ts`) must boot with.
 *
 * Keeping config + database + redis in one module avoids duplicating the
 * ConfigModule setup across entry points and keeps them in sync.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      envFilePath: ['.env'],
      load: [configuration],
      validate: validateEnvironment,
      expandVariables: true,
    }),
    DatabaseModule,
    RedisModule,
  ],
})
export class CoreModule {}
