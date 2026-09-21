import { Module } from '@nestjs/common';
import { QueuesModule } from '../../queues/queues.module';
import { AuthModule } from '../auth/auth.module';
import { PresenceController } from './presence.controller';
import { PresenceService } from './presence.service';

/**
 * Owns Nearby Mode (Redis presence). Imports AuthModule so the shared
 * `JwtModule` (and therefore `JwtAuthGuard`) is available to the controller, and
 * QueuesModule so activating a session can arm its delayed presence-expiry job.
 * `PresenceService` is exported for location ingestion and discovery.
 */
@Module({
  imports: [AuthModule, QueuesModule],
  controllers: [PresenceController],
  providers: [PresenceService],
  exports: [PresenceService],
})
export class PresenceModule {}
