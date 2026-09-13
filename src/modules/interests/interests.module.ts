import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { LocationModule } from '../location/location.module';
import { MatchesModule } from '../matches/matches.module';
import { PresenceModule } from '../presence/presence.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { Interest, InterestSchema } from './interest.schema';
import { InterestsController } from './interests.controller';
import { InterestsService } from './interests.service';

/**
 * Owns the `Interest` model and its lifecycle.
 *
 * Reuses LocationModule + PresenceModule + ProfilesModule to re-verify the same
 * discoverability rules discovery applies, and MatchesModule to materialise a
 * match when an interest is accepted.
 */
@Module({
  imports: [
    AuthModule,
    LocationModule,
    PresenceModule,
    ProfilesModule,
    MatchesModule,
    MongooseModule.forFeature([{ name: Interest.name, schema: InterestSchema }]),
  ],
  controllers: [InterestsController],
  providers: [InterestsService],
  exports: [InterestsService],
})
export class InterestsModule {}
