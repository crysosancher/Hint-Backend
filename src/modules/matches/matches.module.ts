import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { ProfilesModule } from '../profiles/profiles.module';
import { Match, MatchSchema } from './match.schema';
import { MatchesController } from './matches.controller';
import { MatchService } from './matches.service';

/**
 * Owns the `Match` model. Imports AuthModule for the guard's `JwtModule` and
 * ProfilesModule for the other participant's safe profile. `MatchService` is
 * exported so the Interest module can create a match on acceptance.
 */
@Module({
  imports: [
    AuthModule,
    ProfilesModule,
    MongooseModule.forFeature([{ name: Match.name, schema: MatchSchema }]),
  ],
  controllers: [MatchesController],
  providers: [MatchService],
  exports: [MatchService],
})
export class MatchesModule {}
