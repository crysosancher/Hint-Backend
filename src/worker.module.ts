import { Module } from '@nestjs/common';
import { CoreModule } from './core.module';
import { QueueProcessorsModule } from './queues/queue-processors.module';

/**
 * Root module for the background worker process (`worker.ts`).
 *
 * This process runs outside the HTTP server: it registers the BullMQ consumers
 * and Job Schedulers here (see `QueueProcessorsModule`) plus, in later phases,
 * the worker_threads pools. Booting an application context (no HTTP listener)
 * keeps queue work off the API event loop and lets it scale independently.
 */
@Module({
  imports: [CoreModule, QueueProcessorsModule],
})
export class WorkerModule {}
