import { Logger, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import type { AppConfiguration } from './config/configuration';
import { setupSwagger } from './config/swagger.setup';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
  });

  const config = app.get(ConfigService<AppConfiguration, true>);
  const apiPrefix = config.get('app.apiPrefix', { infer: true });
  const port = config.get('app.port', { infer: true });

  // Health endpoints stay outside the versioned prefix for orchestrator probes.
  // The prefix itself carries the version (`api/v1`), matching the API spec, so
  // NestJS URI versioning is intentionally not enabled (it would double the `v1`).
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  const swaggerEnabled = config.get('swagger.enabled', { infer: true });
  const swaggerPath = config.get('swagger.path', { infer: true });
  const docsPrefix = `/${swaggerPath.replace(/^\/+/, '')}`;

  // Apply the security headers everywhere except the docs UI, which relies on
  // inline scripts and would otherwise be blocked by helmet's default CSP.
  const helmetMiddleware = helmet();
  app.use((req: Request, res: Response, next: NextFunction): void => {
    if (swaggerEnabled && req.path.startsWith(docsPrefix)) {
      next();
      return;
    }
    helmetMiddleware(req, res, next);
  });

  app.enableCors({ origin: true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // OpenAPI document + Swagger UI, served outside the API prefix (e.g. /docs).
  if (swaggerEnabled) {
    setupSwagger(app, swaggerPath);
  }

  // Allow `onModuleDestroy` / graceful close for Mongo + Redis.
  app.enableShutdownHooks();

  await app.listen(port);

  logger.log(`API listening on http://localhost:${port}/${apiPrefix}`);
  if (swaggerEnabled) {
    logger.log(`API docs available at http://localhost:${port}/${swaggerPath}`);
  }
}

void bootstrap();
