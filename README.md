# Hint Backend

Hyperlocal matchmaking platform backend — **NestJS + MongoDB + Redis + WebSockets** —
implementing the architecture described in
[`docs/arc/Hyperlocal_Matchmaking_Backend_Architecture_MVP.docx`](docs/arc/Hyperlocal_Matchmaking_Backend_Architecture_MVP.docx).

> **Core rule:** a user may discover, or initiate interest toward, another user only
> when *both* are actively discoverable and their latest valid locations are within
> **250 metres**. The distance check is **server-authoritative** — the client never
> supplies a distance, and exact coordinates are never returned to another user.
> Once an interest becomes a mutual match, the match persists even after the users
> leave the 250 m radius.

This repository also serves as a hands-on lab for **advanced Node.js** concepts —
event loop (macro/micro tasks), worker threads, queues, streams, clustering and
instrumentation. Those concepts are woven directly into production code paths rather
than isolated demos; see [`docs/node-concepts/`](docs/node-concepts/README.md) for a
map of *concept → file → why*.

---

## Stack

| Concern            | Choice                                            |
| ------------------ | ------------------------------------------------- |
| Runtime            | Node.js **24** (LTS line)                          |
| Framework          | NestJS **11** (`@nestjs/common`, `@nestjs/core`)   |
| Database           | MongoDB (Mongoose 8 via `@nestjs/mongoose` 11)      |
| Cache / presence   | Redis (`ioredis` 6)                                |
| Background jobs    | BullMQ 6 (Phase 4)                                 |
| Realtime           | `@nestjs/websockets` + `socket.io` (Phase 5)       |
| CPU offloading     | `worker_threads` + `piscina` (Phase 3/6)           |
| Auth               | `@nestjs/jwt` (Phase 1)                            |
| Validation         | `class-validator` / `class-transformer`            |
| Rate limiting      | `@nestjs/throttler` (Phase 6)                      |
| Logging            | `pino` (Phase 7)                                   |
| API docs           | `@nestjs/swagger` 11 (OpenAPI 3 + Swagger UI)      |
| Tests              | Jest + `ts-jest` + `mongodb-memory-server`         |

> **Why these versions?** NestJS 11 core is **CommonJS**. The `@nestjs/*` satellite
> packages have moved to **ESM-only** on their `12.x` line (e.g. `@nestjs/config@12`,
> `@nestjs/mongoose@12`), which breaks Jest's CommonJS runtime. This project therefore
> pins every satellite to its **NestJS-11-aligned CommonJS major** —
> `@nestjs/config@4`, `@nestjs/mongoose@11`, `@nestjs/jwt@11`, `@nestjs/schedule@6`,
> `@nestjs/event-emitter@3`, `@nestjs/throttler@6` — so the whole tree is consistent
> CommonJS and resolves without `--legacy-peer-deps`. NestJS 12 is intentionally
> deferred until `@nestjs/throttler` supports it (rate limiting is a hard requirement).

---

## Prerequisites

- **Node.js 24** — an [`.nvmrc`](.nvmrc) is provided: `nvm use`
- **npm** (bundled with Node)
- **Docker** (for MongoDB + Redis) — or a locally running MongoDB/Redis

---

## Getting started

```bash
# 1. Use Node 24
nvm use           # reads .nvmrc

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env

# 4. Start MongoDB + Redis (and Mongo Express on :8081)
docker compose up -d

# 5. Run the API in watch mode
npm run start:dev
```

The API is then available at <http://localhost:3000/api/v1>.

### Health endpoints

| Endpoint           | Purpose                                         |
| ------------------ | ----------------------------------------------- |
| `GET /health`      | Liveness — process is up, event loop responsive  |
| `GET /health/ready`| Readiness — MongoDB + Redis both answer          |

Health routes are excluded from the versioned API prefix so orchestrators can probe
them directly.

> **Port 6379 already in use?** If you run Redis locally (e.g. `brew services start redis`)
> it will clash with the `redis` container in `docker-compose.yml`. Either stop the local
> service (`brew services stop redis`) so Docker can bind 6379, or bring up only the Mongo
> containers with `docker compose up -d mongo mongo-express` and let the app talk to your
> local Redis.

### Auth endpoints

| Endpoint                      | Purpose                                              |
| ----------------------------- | ---------------------------------------------------- |
| `POST /api/v1/auth/register`  | Create an account (email + password); returns tokens |
| `POST /api/v1/auth/login`     | Authenticate; returns an access/refresh token pair   |
| `POST /api/v1/auth/refresh`   | Rotate a refresh token (single-use; replay → 401)    |

Signup is **email + password only** — name, age, gender and photo are collected
later on the Profile/Preferences screens. Passwords are hashed with Node's native
`scrypt` (no extra dependency) and refresh tokens are tracked (hashed) in Redis so
they can be rotated on every use and revoked before expiry.

```bash
curl -s -X POST http://localhost:3000/api/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"ada@example.com","password":"Sunshine123","confirmPassword":"Sunshine123"}'
```

### Profile & Preferences endpoints

These two endpoints are **auth-protected** — pass the access token as a Bearer token.

| Endpoint                       | Purpose                                              |
| ------------------------------ | ---------------------------------------------------- |
| `GET /api/v1/profile`          | Read the current user's profile (404 until created)  |
| `PATCH /api/v1/profile`        | Create/update the current user's profile (upsert)    |
| `GET /api/v1/preferences`      | Read the current user's matching preferences         |
| `PATCH /api/v1/preferences`    | Create/update preferences (partial upsert)           |

Fixed vocabularies are exposed as enums (shared by DTOs, Mongo schemas and Swagger):

| Field                  | Enum values                                                                 |
| ---------------------- | --------------------------------------------------------------------------- |
| `gender`               | `woman`, `man`, `non_binary`                                                |
| `preferredGenders[]`   | same as `gender`                                                            |
| `profession`           | `technology_engineering`, `design_creative`, `product_management`, …        |
| `relationshipIntent`   | `dating_romance`, `casual_coffee`, `friends`, `deep_connection`             |

Profile `age` and the preference `ageMin`/`ageMax` range are validated to **13–100**, and `ageMin <= ageMax` is enforced server-side (across partial updates). `bio` is capped at 80 characters. Free-text company/education lives in the profile's optional `education` field.

```bash
TOKEN=...   # accessToken from /api/v1/auth/login

curl -s -X PATCH http://localhost:3000/api/v1/profile \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Maya","age":24,"gender":"woman","profession":"design_creative","bio":"Coffee snob"}'
```

### Nearby Mode & Location endpoints

Both are **auth-protected**. Nearby Mode is an explicit, self-expiring *presence*
session kept in **Redis** (`hint:presence:<userId>`, TTL =
`NEARBY_SESSION_TTL_MINUTES`), so the key disappears on its own. Every activation
also arms a delayed **presence-expiry** job (see *Background queues*) that drops
the now-orphaned location once the session lapses. The durable latest location
lives in **MongoDB** as a GeoJSON `Point` (`[longitude, latitude]`) with a
**2dsphere** index — used by the server-authoritative 250 m discovery query.

| Endpoint                         | Purpose                                                 |
| -------------------------------- | ------------------------------------------------------- |
| `POST /api/v1/nearby/activate`   | Start (or renew) Nearby Mode; returns the session + TTL |
| `POST /api/v1/nearby/deactivate` | Stop Nearby Mode (removes the user from discovery)      |
| `GET /api/v1/nearby/status`      | Current Nearby Mode state + remaining TTL               |
| `POST /api/v1/location`          | Ingest the latest GPS fix (requires active Nearby Mode) |
| `GET /api/v1/location`           | Read the caller's own latest location (404 until set)   |

A fix is rejected with **409** unless Nearby Mode is active and with **400** when the
reported `accuracyMeters` exceeds `LOCATION_MAX_ACCURACY_METERS`. Rapid fixes are
coalesced per user before they are written, and exact coordinates are only ever
returned to their owner.

```bash
TOKEN=...   # accessToken from /api/v1/auth/login

curl -s -X POST http://localhost:3000/api/v1/nearby/activate \
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:3000/api/v1/location \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"latitude":12.971599,"longitude":77.594566,"accuracyMeters":12.5}'
```

### Discovery, Interests & Matches endpoints

All **auth-protected**. Discovery is **server-authoritative**: the caller sends
nothing but their token, MongoDB's **2dsphere** index performs the distance
computation, and only a *coarse* distance (bucketed to 50 m) plus a safe profile
is ever returned — exact coordinates never leave the server.

| Endpoint                                    | Purpose                                                      |
| ------------------------------------------- | ------------------------------------------------------------ |
| `GET /api/v1/discovery/nearby`              | Eligible users within 250 m (nearest first)                   |
| `GET /api/v1/users/:userId`                 | View one discoverable user's profile (404 when not in range)  |
| `POST /api/v1/interests/:userId`            | Send an interest (both users must be mutually discoverable)   |
| `GET /api/v1/interests/incoming`            | Received interests that are still actionable                  |
| `GET /api/v1/interests/outgoing`            | Sent interests that are still pending                         |
| `POST /api/v1/interests/:interestId/accept` | Accept an interest → creates the persistent match             |
| `POST /api/v1/interests/:interestId/ignore` | Ignore an interest (no match)                                 |
| `GET /api/v1/matches`                       | The caller's active matches, with the other participant       |

A user appears in discovery only when **all** of these hold: they are in Nearby
Mode, their latest fix is fresher than `LOCATION_MAX_AGE_SECONDS`, that fix is
within `NEARBY_RADIUS_METERS`, and they have a profile. Sending an interest
re-checks the exact same eligibility server-side, so the 250 m rule cannot be
bypassed by calling the endpoint directly. `GET /users/:userId` reuses it too —
an out-of-range id simply answers **404**, so the route cannot be used to probe
for accounts.

Interest lifecycle: `sent → accepted | ignored | expired`. A pending interest
stops being actionable after `INTEREST_TTL_DAYS`, and accepting one creates a
**persistent match** that survives both users leaving the 250 m radius.
Self-interests are rejected with **400**; a duplicate pending interest (in
either direction) is rejected with **409**. Duplicate matches are impossible by
construction: the participants are stored in a canonical order behind a unique
index.

```bash
TOKEN=...   # accessToken from /api/v1/auth/login

curl -s http://localhost:3000/api/v1/discovery/nearby \
  -H "Authorization: Bearer $TOKEN"

curl -s -X POST http://localhost:3000/api/v1/interests/<userId> \
  -H "Authorization: Bearer $TOKEN"
```

### Background queues (BullMQ)

Phase 4 moves time-based work off the request path and into a **separate worker
process**. The API (`main.ts`) only *produces* jobs; the worker (`worker.ts`)
*consumes* them, so sweeps never compete with HTTP traffic for the event loop.

| Queue              | Job      | Trigger                                              | What it does                                                                 |
| ------------------ | -------- | ---------------------------------------------------- | ---------------------------------------------------------------------------- |
| `interest-expiry`  | `sweep`  | repeatable (default hourly)                          | Marks overdue pending interests `expired` (`InterestsService.expireOverdue`) |
| `presence-expiry`  | `expire` | delayed per session (`NEARBY_SESSION_TTL_MINUTES`)   | Drops the location left behind by a lapsed Nearby Mode session               |
| `location-cleanup` | `sweep`  | repeatable (default every minute)                    | Deletes locations older than `LOCATION_MAX_AGE_SECONDS`                      |

```bash
# Run Mongo + Redis, then the worker (in addition to the API)
docker compose up -d
npm run start:worker
```

The repeatable sweeps are BullMQ **Job Schedulers** (`upsertJobScheduler`), so
they are re-asserted idempotently on every worker boot and survive restarts
because the schedule lives in Redis. Interest expiry is *also* applied lazily on
read/respond — the sweep just makes the terminal state durable, and the
location sweeps are the safety net for sessions that ended without a job (explicit
deactivation, a crashed worker or a lost job).

| Variable                             | Default   | Meaning                                     |
| ------------------------------------ | --------- | ------------------------------------------- |
| `QUEUE_PREFIX`                       | `hint`    | Redis key namespace shared by every queue    |
| `QUEUE_CONCURRENCY`                  | `5`       | Jobs a single worker processes at once       |
| `INTEREST_EXPIRY_SWEEP_INTERVAL_MS`  | `3600000` | Interest-expiry sweep cadence                |
| `LOCATION_CLEANUP_SWEEP_INTERVAL_MS` | `60000`   | Location-cleanup sweep cadence               |

---

## API documentation (Swagger)

Interactive OpenAPI docs are generated from the controllers/DTOs and served
**outside** the API prefix:

| URL              | Purpose                                    |
| ---------------- | ------------------------------------------ |
| `GET /docs`      | Swagger UI                                 |
| `GET /docs/json` | Raw OpenAPI 3 document (machine-readable)  |

```bash
# Inspect the generated document
curl -s http://localhost:3000/docs/json | head
```

Swagger is enabled by default outside production and disabled when
`NODE_ENV=production`. Control it with:

| Variable          | Default                              | Meaning                      |
| ----------------- | ------------------------------------ | ---------------------------- |
| `SWAGGER_ENABLED` | `true` (unless `NODE_ENV=production`) | `true`/`false`               |
| `SWAGGER_PATH`    | `docs`                               | Mount path (no API prefix)   |

JWT-protected endpoints use the `access-token` bearer scheme, so you can paste an
access token into the **Authorize** dialog and call protected routes from the UI.

> **Helmet vs. Swagger UI:** security headers are applied to every route *except*
> the docs path, which needs inline scripts to render. Helmet's default CSP is
> skipped for `SWAGGER_PATH` only — the API keeps its strict policy.

To add docs to new endpoints, use `@ApiTags`, `@ApiOperation` and
`@ApiOkResponse`/`@ApiBadRequestResponse` on the handler, and `@ApiProperty` on DTO
fields. The Nest CLI Swagger plugin (`nest-cli.json` →
`plugins: ["@nestjs/swagger"]`) auto-generates `@ApiProperty` metadata from TypeScript
types, so DTOs need no manual annotation.

---

## Scripts

| Script                 | Description                                 |
| ---------------------- | ------------------------------------------- |
| `npm run start:dev`    | HTTP API in watch mode                      |
| `npm run start:prod`   | HTTP API from `dist/`                        |
| `npm run start:worker` | Background worker process (queue consumers) |
| `npm run repl`         | NestJS REPL for poking at the DI container   |
| `npm run build`        | Compile to `dist/`                           |
| `npm run lint`         | ESLint (flat config) with `--fix`            |
| `npm run format`       | Prettier                                     |
| `npm test`             | Unit tests                                   |
| `npm run test:e2e`     | End-to-end tests                             |

---

## Project structure

```
src/
  main.ts                 # HTTP API entry point
  worker.ts               # Background worker entry point (app context, no HTTP)
  repl.ts                 # NestJS REPL entry point
  app.module.ts           # Root module (HTTP process)
  worker.module.ts        # Root module (worker process)
  core.module.ts          # Shared infra: config + MongoDB + Redis
  config/                 # Typed configuration, env validation, Swagger setup
  infra/
    database/             # Mongoose connection
    redis/                # Shared ioredis client + RedisService
  queues/                 # BullMQ producers, workers + Job Schedulers
  modules/
    health/               # Liveness / readiness + response DTOs
    auth/                 # Register / login / refresh (JWT + Redis rotation)
    users/                # Account data + credentials
    profiles/             # Profile CRUD + safe (third-party) profile projection
    preferences/          # Matching preferences
    presence/             # Nearby Mode (Redis presence + expiry)
    location/             # Latest GPS fix + 2dsphere search
    discovery/            # Eligible users within 250 m (+ GET /users/:userId)
    interests/            # Interest lifecycle (send / accept / ignore / expire)
    matches/              # Persistent mutual matches
  common/                 # Guards, decorators, enums, geo helpers, debouncer
docs/
  node-concepts/          # Advanced Node.js concept map
test/                     # e2e tests
```

---

## Build roadmap

| Phase | Scope                                                                 | Status  |
| ----- | --------------------------------------------------------------------- | ------- |
| 0     | Bootstrap: NestJS + config validation + MongoDB/Redis + health checks | ✅ done |
| 1     | Auth + Users + Profiles + Preferences                                 | ✅ done |
| 2     | Presence (Nearby Mode) + Location ingestion + Redis presence          | ✅ done |
| 3     | Discovery (2dsphere 250 m) + Interest lifecycle + Matches             | ✅ done |
| 4     | BullMQ queues: interest/presence expiry, location cleanup             | ✅ done |
| 5     | WebSockets gateway + chat + notifications                             | ⏳      |
| 6     | Moderation (block/report) + rate limiting                             | ⏳      |
| 7     | Streams (uploads/exports) + instrumentation (AsyncLocalStorage)       | ⏳      |
| 8     | Cluster / worker process + tests + Docker build                       | ⏳      |

See [`docs/node-concepts/README.md`](docs/node-concepts/README.md) for how each advanced
Node.js concept lands across these phases.

