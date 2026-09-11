import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Profile, ProfileSchema } from './profile.schema';
import { ProfilesController } from './profiles.controller';
import { ProfilesService } from './profiles.service';

/**
 * Owns the `Profile` model. Imports AuthModule so the shared `JwtModule` (and
 * therefore `JwtAuthGuard`) is available to the controller.
 */
@Module({
  imports: [AuthModule, MongooseModule.forFeature([{ name: Profile.name, schema: ProfileSchema }])],
  controllers: [ProfilesController],
  providers: [ProfilesService],
  exports: [ProfilesService],
})
export class ProfilesModule {}
