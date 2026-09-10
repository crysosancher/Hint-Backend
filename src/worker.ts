import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker.module';

/**
 * Background worker entry point.
 *
 * Starts a NestJS *application context* (no HTTP server). Later phases attach
 * BullMQ processors and worker_threads pools here so heavy work never blocks
 * the API event loop.
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('WorkerBootstrap');
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['error', 'warn', 'log'],
  });

  app.enableShutdownHooks();

  logger.log('Worker process started (no queue processors registered yet)');
}

void bootstrap();
