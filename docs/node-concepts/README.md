# Advanced Node.js concept map

This project is a **hyperlocal matchmaking backend** that is deliberately built to
exercise Node.js to its full extent. Rather than isolating tutorials in a `labs/`
folder, every advanced concept is **woven into a real production code path**, and
each entry below documents *where* it lives, *why* it is used there, and *how to
observe* it.

> Status legend: ✅ implemented · ⏳ planned (phase noted) · 🔜 in progress

---

## Index

| # | Concept | Where it lives | Status |
| - | ------- | -------------- | ------ |
| 01 | Event loop — macro vs micro tasks | `src/main.ts`, presence debounce, response interceptor | ⏳ Phase 2 |
| 02 | Worker threads (`worker_threads`, `piscina`) | `src/workers/*` — image pipeline + compatibility scoring | ⏳ Phase 3/6 |
| 03 | Queues (BullMQ) | `src/queues/*` — expiry, cleanup, notifications | ⏳ Phase 4 |
| 04 | Streams (`Readable`/`Transform`, backpressure) | `src/streams/*` — uploads + data export | ⏳ Phase 7 |
| 05 | Cluster / child processes | `src/main.ts` cluster wrapper, `src/worker.ts` | ⏳ Phase 8 |
| 06 | Buffers & TypedArrays | image hashing, `SharedArrayBuffer` in workers | ⏳ Phase 3 |
| 07 | `AsyncLocalStorage` | request correlation IDs via `src/instrumentation/*` | ⏳ Phase 7 |
| 08 | `diagnostics_channel` | internal pub/sub for discovery/interest events | ⏳ Phase 7 |
| 09 | RxJS / EventEmitter2 | `@nestjs/event-emitter` domain events → WebSocket pushes | ⏳ Phase 5 |
| 10 | NestJS advanced (dynamic modules, DI scopes, REPL) | `QueueModule`, guards/interceptors, `src/repl.ts` | ⏳ ongoing |
| 11 | Module system: CommonJS vs ESM | `package.json` pins, `tsconfig.json`, `jest.config.js` | ✅ Phase 0 |

---

## Already in place (Phase 0)

- **Graceful shutdown across the event loop** — `app.enableShutdownHooks()` in
  `src/main.ts` and `src/worker.ts` lets NestJS run `onModuleDestroy` for the Mongo
  and Redis clients, so `SIGTERM` doesn't tear down in-flight work.
- **Bounded, non-blocking I/O with backoff** — the ioredis client in
  `src/infra/redis/redis.module.ts` installs a `retryStrategy` with capped backoff and
  subscribes to `connect`/`ready`/`error`/`close` events. Reconnect attempts are
  scheduled on the event loop and never block the request path.
- **Fail-fast at boot** — `src/config/env.validation.ts` validates the environment
  before the first DB call, so a misconfiguration crashes the process immediately
  instead of surfacing as a confusing runtime error later.
- **Two independent processes** — `main.ts` (HTTP) and `worker.ts` (application
  context) share `CoreModule` but run separately, which is the foundation for
  offloading CPU/queue work off the API event loop.

---

## How to read each note

Every `NN-*.md` note follows the same shape:

1. **The concept** — what Node actually does under the hood.
2. **Where it lives here** — exact file(s) and line references.
3. **Why here** — the production reason (not a contrived example).
4. **How to observe it** — a command, test, or log output that proves the behaviour.

Notes are added in the same commit as the code that uses them, so the documentation
never drifts ahead of reality.
