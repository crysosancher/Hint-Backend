import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Owns Nearby Mode (Redis presence). Imports AuthModule so the shared
 * `JwtModule` (and therefore `JwtAuthGuard`) is available to the controller.
 * `PresenceService` is exported for location ingestion and discovery.
 */
@Module({
  imports: [AuthModule],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
