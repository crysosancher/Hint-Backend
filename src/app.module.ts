import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { AuthModule } from './modules/auth/auth.module';
import { DiscoveryModule } from './modules/discovery/discovery.module';
import { HealthModule } from './modules/health/health.module';
import { InterestsModule } from './modules/interests/interests.module';
import { LocationModule } from './modules/location/location.module';
import { MatchesModule } from './modules/matches/matches.module';
import { PreferencesModule } from './modules/preferences/preferences.module';
import { PresenceModule } from './modules/presence/presence.module';
import { ProfilesModule } from './modules/profiles/profiles.module';

/**
 * Root module for the HTTP API process.
 *
 * Feature modules (chat, notifications, moderation, events) are added here
 * phase by phase.
 */
@Module({
  imports: [
    CoreModule,
    HealthModule,
    AuthModule,
    ProfilesModule,
    PreferencesModule,
    PresenceModule,
    LocationModule,
    DiscoveryModule,
    InterestsModule,
    MatchesModule,
  ],
})
export class AppModule {}

