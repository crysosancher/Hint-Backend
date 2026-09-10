import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';

/**
 * Root module for the background worker process (`worker.ts`).
 *
 * This process runs outside the HTTP server: BullMQ consumers, scheduled
 * cleanup and worker_threads pools will be registered here in later phases.
 * Booting an application context (no HTTP listener) keeps it separate from API
 * traffic and lets it scale independently.
 */
@Module({
  imports: [CoreModule],
})
export class WorkerModule {}
