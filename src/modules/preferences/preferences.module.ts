import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { Preference, PreferenceSchema } from './preference.schema';
import { PreferencesController } from './preferences.controller';
import { PreferencesService } from './preferences.service';

/**
 * Owns the `Preference` model. Imports AuthModule so the shared `JwtModule`
 * (and therefore `JwtAuthGuard`) is available to the controller.
 */
@Module({
  imports: [
    AuthModule,
    MongooseModule.forFeature([{ name: Preference.name, schema: PreferenceSchema }]),
  ],
  controllers: [PreferencesController],
  providers: [PreferencesService],
  exports: [PreferencesService],
})
export class PreferencesModule {}
