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
  modules/
    health/               # Liveness / readiness + response DTOs
  common/                 # Guards, interceptors, filters, pipes (grows per phase)
docs/
  node-concepts/          # Advanced Node.js concept map
test/                     # e2e tests
```

---

## Build roadmap

| Phase | Scope                                                                 | Status  |
| ----- | --------------------------------------------------------------------- | ------- |
| 0     | Bootstrap: NestJS + config validation + MongoDB/Redis + health checks | ✅ done |
| 1     | Auth + Users (signup / login / refresh) + Profiles + Preferences      | 🚧 auth + users done |
| 2     | Presence (Nearby Mode) + Location ingestion + Redis presence          | ⏳      |
| 3     | Discovery (2dsphere 250 m) + Interest lifecycle + Matches             | ⏳      |
| 4     | BullMQ queues: interest/presence expiry, location cleanup             | ⏳      |
| 5     | WebSockets gateway + chat + notifications                             | ⏳      |
| 6     | Moderation (block/report) + rate limiting                             | ⏳      |
| 7     | Streams (uploads/exports) + instrumentation (AsyncLocalStorage)       | ⏳      |
| 8     | Cluster / worker process + tests + Docker build                       | ⏳      |

See [`docs/node-concepts/README.md`](docs/node-concepts/README.md) for how each advanced
Node.js concept lands across these phases.

