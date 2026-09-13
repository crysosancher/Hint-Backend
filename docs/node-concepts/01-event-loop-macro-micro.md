# 01 — The event loop: macro-tasks vs micro-tasks

> Status: ✅ implemented (Phase 2) — this note documents a real scheduling choice
> inside location ingestion, not a contrived demo.

## The concept

Node runs JavaScript on a **single thread** driven by an event loop. Work is
scheduled onto two distinct queues:

- **Macro-tasks (task queue)** — one per turn of the loop: `setTimeout` (timers
  phase), `setImmediate` (check phase), I/O callbacks (poll phase). The loop runs
  *one* macro-task, then drains micro-tasks, then moves to the next phase.
- **Micro-tasks** — `process.nextTick`, `Promise` reactions and `queueMicrotask`.
  They are drained **completely** after the current macro-task and after every
  phase transition, *before* the next macro-task runs.

The critical consequence: a promise created inside an I/O callback resolves in the
**same** turn as the callback, while a `setImmediate` scheduled from that callback
runs in a **later** turn. That gap is exactly what lets us batch work.

## Where it lives here

- `src/common/debounce/keyed-debouncer.ts` — `KeyedDebouncer.schedule()` returns a
  `Promise` (a micro-task boundary) but arms the actual flush with a **macro-task**:
  `setImmediate` when the window is `0` (check phase) or `setTimeout` for a wider
  window (timers phase).
- `src/modules/location/location.service.ts` — wraps MongoDB writes in the
  debouncer, so a burst of GPS fixes for one user collapses into a single write.

```ts
// window = 0  →  check phase (setImmediate): coalesces the whole current turn
const immediate = setImmediate(() => void this.run(key, entry));
// window  > 0 →  timers phase (setTimeout): classic trailing debounce
const timer = setTimeout(() => void this.run(key, entry), this.waitMs);
```

## Why here

A client in Nearby Mode pushes a location heartbeat continuously. Individual fixes
are cheap, but each one is a MongoDB write, so a burst (reconnects, multiple
sources, retries) is wasteful — only the **latest** fix matters. Coalescing per
user turns *N* writes into one.

The macro/micro distinction is the whole point of the design: if the flush were
armed with `queueMicrotask` it would fire **before** the next I/O callback, so two
requests arriving in the same poll phase would each trigger their own write. Arming
it with a macro-task lets every `schedule()` call made during the current turn fold
into one flush, while latency stays ~one tick because the flush is not awaited by
unrelated work.

## How to observe it

```bash
node -e "console.log('sync'); process.nextTick(()=>console.log('nextTick')); \
  Promise.resolve().then(()=>console.log('microtask')); \
  setTimeout(()=>console.log('timeout'),0); setImmediate(()=>console.log('immediate'))"
```

```
sync
nextTick          # micro-tasks drain first (nextTick before promises)
microtask
immediate         # macro-tasks: check phase vs timers phase order is not
timeout           #   guaranteed from the main module
```

The unit test shows the coalescing directly:

```bash
npx jest src/common/debounce/keyed-debouncer.spec.ts
```

```
✓ coalesces writes scheduled in the same turn and keeps the latest value
```

Three synchronous `schedule('user-1', …)` calls produce **one** flush carrying the
last value, and all three returned promises settle together — micro-task callers
folded into a macro-task flush.
