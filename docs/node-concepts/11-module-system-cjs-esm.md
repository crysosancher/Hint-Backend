# 11 — Module systems: CommonJS vs ESM

> Status: ✅ implemented (Phase 0) — this note documents a real decision forced by
> the dependency tree, not a contrived example.

## The concept

Node has two module systems:

- **CommonJS (CJS)** — `require()` / `module.exports`, synchronous, loaded as a
  "script". This is what NestJS 11 core (`@nestjs/common`, `@nestjs/core`) ships as.
- **ES Modules (ESM)** — `import` / `export`, asynchronous, statically analysable,
  `package.json` `"type": "module"`. The `@nestjs/*` satellite packages moved to
  **ESM-only** on their `12.x` line.

A file's module system is decided by the nearest `package.json`'s `"type"` field
(`"module"` → ESM, otherwise CJS) plus the file extension (`.mjs` / `.cjs` override).

Node has an interop bridge: **`require(esm)`**, which lets CommonJS `require()` an ESM
module synchronously (stable on modern Node). This is why the compiled app runs even
though `@nestjs/mongoose` is ESM — the NestJS CLI compiles our TypeScript to CJS, and
Node 24's `require(esm)` loads the ESM dependency for us.

## Where it lives here

- `package.json` → pinned dependency majors. Every `@nestjs/*` satellite is held at its
  **NestJS-11-aligned CommonJS major**:

  | Package                   | Pinned | Line avoided | Why                     |
  | ------------------------- | ------ | ------------ | ----------------------- |
  | `@nestjs/config`          | `^4`   | `12.x` (ESM) | keeps the tree CJS      |
  | `@nestjs/mongoose`        | `^11`  | `12.x` (ESM) | keeps the tree CJS      |
  | `@nestjs/jwt`             | `^11`  | `12.x` (ESM) | keeps the tree CJS      |
  | `@nestjs/schedule`        | `^6`   | `12.x` (ESM) | keeps the tree CJS      |
  | `@nestjs/event-emitter`   | `^3`   | `12.x` (ESM) | keeps the tree CJS      |
  | `@nestjs/throttler`       | `^6`   | —            | no NestJS 12 support yet|

- `tsconfig.json` → `"module": "commonjs"`, `"moduleResolution": "node"`. The NestJS CLI
  (`nest build`) compiles to CJS into `dist/`.
- `jest.config.js` / `test/jest-e2e.json` → Jest runs on a CommonJS runtime and does
  **not** transform `node_modules`, so it cannot `require()` an ESM-only dependency.

## Why here

The failure mode is subtle and worth internalising: the **app runs fine** under Node 24
(thanks to `require(esm)`), but **Jest fails** with:

```
Must use import to load ES Module: node_modules/@nestjs/mongoose/dist/index.js
```

That asymmetry — production works, tests break — is a classic ESM/CJS trap. Rather than
fight it with Jest ESM flags (or `transformIgnorePatterns` gymnastics), the project
stays deliberately **all-CommonJS**, which matches NestJS 11's own output and keeps the
build, tests and tooling simple and consistent.

## How to observe it

```bash
# Inspect the module system of any dependency:
node -p "require('./node_modules/@nestjs/mongoose/package.json').type"   # -> module
node -p "require('./node_modules/@nestjs/common/package.json').type"     # -> undefined (CJS)

# Find a CJS-aligned version of a package:
npm view @nestjs/mongoose@^11 type     # (empty = CommonJS)

# The whole tree resolving without legacy peer deps proves the majors line up:
npm ls --depth=0
```

## When you *would* switch to ESM

If the project later moves to NestJS 12 (ESM-first), the migration path is: set
`"type": "module"`, switch `tsconfig` to `"module": "nodenext"`, add `.js` extensions to
relative imports, and run Jest with `--experimental-vm-modules` (or move to Vitest,
which handles ESM natively). That is a deliberate, project-wide decision — not something
to do half-way.
