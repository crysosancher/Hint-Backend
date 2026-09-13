/**
 * Coalesces repeated writes for the same key into a single flush.
 *
 * Location ingestion uses this: a client can push several GPS fixes in quick
 * succession, but only the latest needs to be persisted. The trailing value
 * wins and every caller resolves once that single write completes.
 *
 * ## Event-loop framing (see `docs/node-concepts/01-event-loop-macro-micro.md`)
 *
 * With `waitMs: 0` the flush is scheduled with `setImmediate`, i.e. the
 * **check** phase — a macro-task. Every `schedule()` call made during the
 * current event-loop turn therefore folds into one flush, while request
 * latency stays at roughly a single tick.
 *
 * Micro-tasks (`queueMicrotask` / `process.nextTick`) are deliberately *not*
 * used for the window: they drain before the next macro-task, so they would
 * not coalesce two callbacks arriving in the same phase. That difference is
 * exactly what the Phase 2 concept note demonstrates.
 */
export type KeyedFlushFunction<T> = (key: string, value: T) => Promise<void>;

export interface KeyedDebouncerOptions {
  /**
   * Quiet period, in milliseconds, before a pending value is flushed.
   *
   * `0` (the default) flushes on the next event-loop turn via `setImmediate`
   * (check phase). A positive value uses `setTimeout` (timers phase) for a
   * classic trailing debounce with a wider window.
   */
  waitMs?: number;
}

interface Pending<T> {
  value: T;
  resolvers: Array<() => void>;
  rejecters: Array<(error: unknown) => void>;
  /** Cancels the currently armed flush (immediate or timeout). */
  cancel: () => void;
}

export class KeyedDebouncer<T> {
  private readonly pending = new Map<string, Pending<T>>();
  private readonly waitMs: number;

  constructor(
    private readonly flush: KeyedFlushFunction<T>,
    options: KeyedDebouncerOptions = {},
  ) {
    this.waitMs = options.waitMs ?? 0;
  }

  /** Number of keys with a write still waiting to be flushed. */
  get pendingKeys(): number {
    return this.pending.size;
  }

  /**
   * Schedules `value` for `key`. If a write for the key is already pending it
   * is superseded (latest value wins) and the returned promise settles when
   * the coalesced flush completes — so all callers observe the same outcome.
   */
  schedule(key: string, value: T): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const existing = this.pending.get(key);
      if (existing) {
        existing.value = value;
        existing.resolvers.push(resolve);
        existing.rejecters.push(reject);
        existing.cancel();
        existing.cancel = this.arm(key, existing);
        return;
      }

      const entry: Pending<T> = {
        value,
        resolvers: [resolve],
        rejecters: [reject],
        cancel: () => undefined,
      };
      entry.cancel = this.arm(key, entry);
      this.pending.set(key, entry);
    });
  }

  /** Flushes one key immediately (no-op when nothing is pending). */
  async flushKey(key: string): Promise<void> {
    const entry = this.pending.get(key);
    if (entry) await this.run(key, entry);
  }

  /** Flushes every pending key — used on shutdown so no write is lost. */
  async flushAll(): Promise<void> {
    await Promise.all([...this.pending.keys()].map((key) => this.flushKey(key)));
  }

  private arm(key: string, entry: Pending<T>): () => void {
    if (this.waitMs > 0) {
      const timer = setTimeout(() => void this.run(key, entry), this.waitMs);
      return () => clearTimeout(timer);
    }

    const immediate = setImmediate(() => void this.run(key, entry));
    return () => clearImmediate(immediate);
  }

  private async run(key: string, entry: Pending<T>): Promise<void> {
    // A newer entry may have replaced this one, or a manual flush already ran.
    if (this.pending.get(key) !== entry) return;

    entry.cancel();
    this.pending.delete(key);

    try {
      await this.flush(key, entry.value);
      for (const resolve of entry.resolvers) resolve();
    } catch (error) {
      for (const reject of entry.rejecters) reject(error);
    }
  }
}
