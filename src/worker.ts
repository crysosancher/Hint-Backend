import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Background worker entry point.
 *
 * Starts a NestJS *application context* (no HTTP server) with the BullMQ
 * consumers and Job Schedulers registered by `QueueProcessorsModule`. Running
 * separately from the API keeps queue work off the request path and lets the
 * two processes scale independently.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();

  logger.log('Worker process started (queue consumers + schedulers registered)');
}

void bootstrap();
