import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { PresenceModule } from '../presence/presence.module';
import { LocationController } from './location.controller';
import { Location, LocationSchema } from './location.schema';
import { LocationService } from './location.service';

/**
 * Owns the `Location` model and location ingestion. Imports AuthModule for the
 * guard's `JwtModule` and PresenceModule to require an active Nearby Mode
 * session before accepting a fix.
 */
@Module({
  imports: [
    AuthModule,
    PresenceModule,
    MongooseModule.forFeature([{ name: Location.name, schema: LocationSchema }]),
  ],
  controllers: [LocationController],
  providers: [LocationService],
  exports: [LocationService],
})
export class LocationModule {}
