import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { PresenceModule } from '../presence/presence.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { DiscoveryController } from './discovery.controller';
import { DiscoveryService } from './discovery.service';
import { EligibleUsersController } from './users.controller';

/**
 * Owns the 250 m discovery query.
 *
 * Imports AuthModule for the guard's `JwtModule`, LocationModule for the
 * `2dsphere` search, PresenceModule to require an active Nearby Mode session and
 * ProfilesModule to return safe profile data.
 */
@Module({
  imports: [AuthModule, PresenceModule, LocationModule, ProfilesModule],
  controllers: [DiscoveryController, EligibleUsersController],
  providers: [DiscoveryService],
  exports: [DiscoveryService],
})
export class DiscoveryModule {}
