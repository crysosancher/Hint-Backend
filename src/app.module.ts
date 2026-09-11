import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { AuthModule } from './modules/auth/auth.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Root module for the HTTP API process.
 *
 * Feature modules (users, profiles, preferences, presence, location, discovery,
 * interests, matches, chat, notifications, moderation, events) are added here
 * phase by phase.
 */
@Module({
  imports: [CoreModule, HealthModule, AuthModule],
})
export class AppModule {}
