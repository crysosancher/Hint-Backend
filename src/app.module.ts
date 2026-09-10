import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { HealthModule } from './modules/health/health.module';

/**
 * Root module for the HTTP API process.
 *
 * Feature modules (auth, users, profiles, preferences, presence, location,
 * discovery, interests, matches, chat, notifications, moderation, events) are
 * added here phase by phase.
 */
@Module({
  imports: [CoreModule, HealthModule],
})
export class AppModule {}
