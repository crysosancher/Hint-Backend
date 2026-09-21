import {
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type ConnectionOptions, type Job, Worker } from 'bullmq';
import type { AppConfiguration } from '../config/configuration';
import { QUEUE_CONNECTION } from './queue.constants';

/**
 * Shared lifecycle for a BullMQ consumer.
 *
 * The worker is started in `onModuleInit` and closed in `onModuleDestroy`, so
 * graceful shutdown lets an in-flight job finish before the connection closes.
 *
 * Only the worker process imports the processors (via `QueueProcessorsModule`),
 * which keeps background jobs off the API's event loop — the whole point of
 * running `main.ts` and `worker.ts` as separate processes.
 *
 * Subclasses remain unit-testable: `process()` holds the job handler and can be
 * called directly without a Redis connection.
 */
@Injectable()
export abstract class QueueProcessor<TData = unknown> implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(this.constructor.name);
  private worker?: Worker<TData>;

  /** Redis-backed queue this processor consumes. */
  protected abstract readonly queueName: string;

  constructor(
    @Inject(QUEUE_CONNECTION) private readonly connection: ConnectionOptions,
    protected readonly config: ConfigService<AppConfiguration, true>,
  ) {}

  /**
   * Handles a single job. Public so the handler can be exercised in unit tests
   * without spinning up a worker.
   */
  abstract process(job: Job<TData>): Promise<unknown>;

  onModuleInit(): void {
    this.worker = new Worker<TData>(this.queueName, (job) => this.process(job), {
      connection: this.connection,
      prefix: this.config.get('queue.prefix', { infer: true }),
      concurrency: this.config.get('queue.concurrency', { infer: true }),
    });

    this.worker.on('failed', (job, error) => {
      this.logger.error(
        `Job ${job?.id ?? 'unknown'} on ${this.queueName} failed: ${error.message}`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close();
  }
}
