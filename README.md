# RevaHub

A self-hosted, event-driven automation platform with a plugin-based module and task ecosystem. Written in TypeScript, distributed via npm, managed through a web dashboard.

## Overview

RevaHub is the infrastructure layer for automation. Users install and configure **modules** (persistent service adapters) and **tasks** (automation scripts) as npm packages. Tasks are triggered by module events, cron schedules, webhooks, or manually. Everything is configured and monitored through a built-in web dashboard.

The platform runs as a single Node.js process. Module instances run in isolated worker threads. All packages are standard npm packages discovered and installed via npm.

## Features

- **Module system** — Persistent service adapters run in isolated worker threads. One or more instances per module, each with its own configuration.
- **Task system** — Short-lived async automation scripts triggered by events, cron, webhooks, or manually.
- **Event bus** — Module instances emit named events routed to matching task configs.
- **Auto-generated UI forms** — Option definitions in `package.json` drive the configuration UI automatically.
- **Marketplace** — Browse, install, update, and uninstall modules and tasks directly from the dashboard.
- **Live log streaming** — Instance and task-run logs streamed via WebSocket.
- **PostgreSQL storage** — All state persisted via Drizzle ORM with migrations.

---

## Quick Start (Users)

RevaHub requires **Node.js 22+** and a **PostgreSQL** database.

### Option A: Docker (recommended)

```sh
curl -O https://raw.githubusercontent.com/Revadike/RevaHub/master/docker-compose.yml
docker compose up -d
```

This starts RevaHub and PostgreSQL together. Open `http://localhost:3000`.

### Option B: npx

Bring your own PostgreSQL and run:

```sh
DATABASE_URL=postgresql://user:pass@localhost:5432/revahub npx revahub
```

Or with the default connection (`revahub:revahub@localhost:5432/revahub`):

```sh
npx revahub
```

### Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `postgresql://revahub:revahub@localhost:5432/revahub` | PostgreSQL connection string |
| `PORT` | `3000` | HTTP server port |
| `REVAHUB_DIR` | `~/.revahub` | Working directory for data and installed packages |

On first run, RevaHub will automatically run database migrations, register native packages, and start the HTTP server.

---

## Development

### Prerequisites

- Node.js 22+
- Docker (for the dev database)

### Setup

```sh
git clone https://github.com/Revadike/RevaHub.git
cd RevaHub
npm install
```

### Start the dev database

```sh
npm run db:up
```

This spins up a PostgreSQL 17 container via `docker-compose.dev.yml` on port `5432` with credentials `revahub:revahub`.

### Build and run

```sh
npm run build          # compile all packages
npm run build:ui       # build the Vue SPA
npm start              # start RevaHub (http://localhost:3000)
```

### Available scripts

| Script | Description |
|---|---|
| `npm run build` | Compile all TypeScript packages |
| `npm run build:ui` | Build the Vue SPA into `packages/revahub/dist/ui/` |
| `npm run dev` | Watch-mode TypeScript compilation |
| `npm start` | Run the compiled RevaHub server |
| `npm run db:up` | Start the dev PostgreSQL container |
| `npm run db:down` | Stop the dev PostgreSQL container |
| `npm run db:reset` | Destroy and recreate the dev database |
| `npm run lint` | Lint everything |
| `npm run lint:fix` | Lint and auto-fix |

### Docker build

```sh
docker build -t revahub .
docker run -e DATABASE_URL=postgresql://revahub:revahub@host.docker.internal:5432/revahub -p 3000:3000 revahub
```

Or use the full-stack compose file:

```sh
docker compose up --build
```

---

## Configuration

The working directory can be overridden via the `REVAHUB_DIR` environment variable. The server port is configurable in the dashboard under **Settings** (requires restart).

## Package Development

### Modules

A module is an npm package named `revahub-module-<name>`. It exports a factory function that receives a `ModuleContext` and returns a running instance object.

```ts
export default async (ctx: ModuleContext) => {
  // initialise service connection using ctx.options
  ctx.onDestroy(() => { /* cleanup */ });
  return instance; // public methods are auto-detected
};
```

The `package.json` must include a `"revahub"` block with `type: "module"`, a `label`, and an `options` array describing the configuration fields.

### Tasks

A task is an npm package named `revahub-task-<name>`. It exports a single async function:

```ts
export default async (ctx: TaskContext) => {
  const result = await ctx.instances.myInstance.doSomething();
  return result;
};
```

### Triggers

| Trigger | Description |
|---|---|
| `cron` | Fired on a cron schedule |
| `event` | Fired when a module instance emits a named event |
| `manual` | User clicks **Run** in the dashboard |
| `webhook` | `POST /webhooks/:taskConfigId` |

## Architecture

```
revahub (single Node.js process)
│
├── Module Manager
│     └── Worker Thread per instance (crash isolated)
│
├── Core Event Bus (EventEmitter)
│
├── Task Runner
│     ├── Cron scheduling (node-cron)
│     └── Webhook routes (Fastify)
│
├── Database (PostgreSQL via Drizzle ORM)
│
└── HTTP Server (Fastify)
      └── Vue 3 + Vuetify SPA (pre-built, served as static files)
```

## Native Packages

The following packages ship pre-installed and are protected from uninstallation:

| Package | Type | Description |
|---|---|---|
| `revahub-module-database` | Module | PostgreSQL access; auto-injected as `ctx.instances.database` |
| `revahub-module-logger` | Module | Structured logging; auto-injected as `ctx.instances.logger` |
| `revahub-task-cleanup-logs` | Task | Deletes log entries older than a configured age |

## Monorepo

This repository is an npm workspace monorepo. Native packages live under `packages/` alongside the core.

```
packages/
  revahub/                    # core platform, HTTP server, dashboard
  revahub-module-database/    # native database module
  revahub-module-logger/      # native logger module
  revahub-task-cleanup-logs/  # native log cleanup task
```

---

## Tech Stack

| Concern | Choice |
|---|---|
| Runtime | Node.js LTS |
| Language | TypeScript |
| HTTP server | Fastify |
| Frontend | Vue 3 + Vuetify + Vite |
| Database | PostgreSQL |
| ORM | Drizzle ORM |
| Module isolation | `node:worker_threads` |
| Cron | `node-cron` |

## License

Apache-2.0 — see [LICENSE.txt](LICENSE.txt).
