# 03 — Queues (BullMQ): durability, delay and repeatable work

> Status: ✅ implemented (Phase 4) — the API only *produces* jobs; a separate
> `worker.ts` process consumes them.

## The concept

A **queue** decouples "something must happen later" from "respond to the user
now". BullMQ keeps the queue in Redis, which buys three distinct primitives:

- **Delayed jobs** — `queue.add(name, data, { delay })` parks a job until a
  wall-clock deadline passes. Nothing has to poll.
- **Job Schedulers** (v6) — `queue.upsertJobScheduler(id, { every })` registers a
  *repeatable* job. The schedule lives in Redis, not in the process, so it
  survives restarts and is re-asserted idempotently on every boot.
- **Job ids** — `{ jobId }` makes adds idempotent per id. A second `add` with an
  existing id is a no-op, which is why replacement (below) needs an explicit
  `remove()` first.

BullMQ needs its **own** Redis connections: blocking consumers (`Worker`) call
`BRPOPLPUSH`-style commands that must not be aborted by a request timeout, so the
connection requires `maxRetriesPerRequest: null`. `src/queues/queues.module.ts`
passes plain connection *options* and lets BullMQ own them rather than reusing the
shared ioredis client from `RedisModule`.

## Where it lives here

- `src/queues/queues.module.ts` — the producers (`Queue` instances only, no
  `Worker`), so importing it into the API can never make the API consume jobs.
- `src/queues/queue-processors.module.ts` — the consumers, imported by
  `worker.ts` only.
- `src/queues/queue-processor.base.ts` — starts a `Worker` in `onModuleInit` and
  closes it in `onModuleDestroy`, so an in-flight job finishes on `SIGTERM`.
- `src/queues/queue-schedulers.service.ts` — the two repeatable sweeps.
- `src/modules/presence/presence.service.ts` — arms the delayed job.

```ts
// Repeatable: a sweep that owns its own schedule, not the process's lifetime.
await this.locationCleanup.upsertJobScheduler(
  QUEUE_SCHEDULERS.locationCleanupSweep,
  { every: cleanupIntervalMs },
  { name: QUEUE_JOBS.locationCleanupSweep },
);

// Delayed + stable id: replace the pending job so a renewed session extends it.
await this.presenceExpiry.remove(presenceExpiryJobId(userId));
await this.presenceExpiry.add(QUEUE_JOBS.presenceExpiry, { userId }, { jobId, delay: ttlSeconds * 1000, removeOnComplete: true });
```

## Why here

Three rules in this domain are **time-based**, not request-based:

| Rule | Primitive | Queue |
| ---- | --------- | ----- |
| A pending interest stops being actionable after `INTEREST_TTL_DAYS` | repeatable sweep | `interest-expiry` |
| A Nearby Mode session ends when its Redis TTL lapses | delayed job | `presence-expiry` |
| A location is only kept while it is fresh enough to be discoverable | repeatable sweep | `location-cleanup` |

Doing this in-process with `@nestjs/schedule` would tie the work to the API's
event loop. Running it in `worker.ts` instead means a slow sweep cannot delay an
HTTP response, and either side can scale (or restart) independently.

Two subtleties the design encodes:

1. **Presence expiry is a *side-effect* trigger, not the source of truth.** Redis
   still owns the TTL — the worker only reacts once the key is gone (it deletes
   the orphaned location, and is the natural home for the Phase 5
   `nearby.user.disappeared` push). Re-activation removes and re-adds the job, so
   the stable `jobId` cannot silently keep the *old*, earlier deadline.
2. **Expiry is enforced twice.** Interests expire lazily on read/respond *and* via
   the sweep; locations are dropped by the presence job *and* by the sweep. The
   queue is the durable half, the request path stays correct even if the worker is
   down.

## How to observe it

```bash
# Terminal 1 — API          Terminal 2 — worker (consumers + schedulers)
npm run start:dev           npm run start:worker
```

```bash
# Inspect the queue keys BullMQ owns (namespaced by QUEUE_PREFIX=hint)
redis-cli --scan --pattern 'hint:location-cleanup:*'
redis-cli --scan --pattern 'hint:presence-expiry:*'
```

```bash
# The unit tests exercise the handlers and the scheduler registration directly,
# with no Redis required.
npx jest src/queues
```

```
PASS src/queues/queue-schedulers.service.spec.ts
PASS src/queues/processors/interest-expiry.processor.spec.ts
PASS src/queues/processors/presence-expiry.processor.spec.ts
PASS src/queues/processors/location-cleanup.processor.spec.ts
```

The handlers are plain methods (`process()`, `expireOverdue()`,
`deleteStale()`), so the sweep logic is tested without a broker — the queue only
adds *when* it runs, never *what* it does.
