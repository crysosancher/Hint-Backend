import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MongooseModule, MongooseModuleOptions } from '@nestjs/mongoose';
import type { AppConfiguration } from '../../config/configuration';

/**
 * Wires NestJS to MongoDB through Mongoose.
 *
 * The connection is created lazily by Mongoose (buffering commands until the
 * connection is ready), so feature modules can inject models immediately.
 */
@Module({
  imports: [
    MongooseModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfiguration, true>): MongooseModuleOptions => ({
        uri: config.get('mongo.uri', { infer: true }),
        // Keep Mongoose's internal connection pool bounded and observable.
        maxPoolSize: 20,
        minPoolSize: 2,
        serverSelectionTimeoutMS: 10_000,
        // `mongodb` driver autoIndex is fine in dev; production should rely on
        // migrations instead. Controlled by NODE_ENV.
        autoIndex: config.get('app.nodeEnv', { infer: true }) !== 'production',
      }),
    }),
  ],
})
export class DatabaseModule {}
