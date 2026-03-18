# RevaHub

A self-hosted, event-driven automation platform with a filesystem-based plugin ecosystem. Written in TypeScript, powered by PGlite, distributed via npm, managed through a web dashboard.

## Overview

RevaHub is the infrastructure layer for automation. Users install and configure **modules** (persistent service adapters) and **tasks** (automation scripts) as npm packages. Tasks are triggered by module events, cron schedules, webhooks, or manually. Everything is configured and monitored through a built-in web dashboard.

The platform runs as a single Node.js process with an embedded PGlite database. Module instances run in isolated worker threads. All packages are standard npm packages discovered from the filesystem and managed via npm.

## Key Features

- **Embedded database** — PGlite (PostgreSQL in WebAssembly) eliminates external database dependencies
- **Filesystem-based ecosystem** — Packages discovered from `node_modules` and local directories, no metadata in database
- **Module system** — Persistent service adapters run in isolated worker threads with one or more instances per module
- **Task system** — Short-lived async automation scripts triggered by events, cron, webhooks, or manually
- **Event bus** — Module instances emit named events routed to matching task configs
- **Auto-generated UI forms** — Option definitions in `package.json` drive the configuration UI automatically
- **Package marketplace** — Browse, install, update, and uninstall modules and tasks directly from the dashboard
- **Live log streaming** — Instance and task-run logs streamed via WebSocket
- **Hot-reload support** — Local packages watched with chokidar for instant updates during development
- **Native packages** — Core functionality provided by built-in revahub-module-* and revahub-task-* packages

---

## Quick Start

RevaHub requires **Node.js 22+**. No external database needed!

### Installation

```sh
npx revahub
```

On first run, RevaHub will:
- Create `~/.revahub/` directory structure
- Initialize PGlite database
- Run migrations
- Register native packages
- Start HTTP server on port 3000

Open `http://localhost:3000` to access the dashboard.

### CLI Commands

```sh
revahub start                          # Start the server (default command)
revahub create module <name>           # Scaffold a new module package
revahub create task <name>             # Scaffold a new task package
revahub install module <name>          # Install a module from npm
revahub install task <name>            # Install a task from npm
revahub uninstall module <name>        # Uninstall a module
revahub uninstall task <name>          # Uninstall a task
```

### Configuration

- **Server port**: Configurable in the dashboard under **Settings** (requires restart)
- **Local packages directory**: Optionally configure a custom directory for local development packages
- **Working directory**: `~/.revahub/` (contains database, packages, and config)

---

## Development

### Prerequisites

- Node.js 22+

### Setup

```sh
git clone https://github.com/Revadike/RevaHub.git
cd RevaHub
npm install
```

### Build and run

```sh
npm run build          # Compile all packages
npm run build:ui       # Build the Vue SPA
npm start              # Start RevaHub (http://localhost:3000)
```

### Available scripts

| Script | Description |
|---|---|
| `npm run build` | Compile all TypeScript packages |
| `npm run build:ui` | Build the Vue SPA into `packages/revahub/dist/ui/` |
| `npm run dev` | Watch-mode TypeScript compilation |
| `npm start` | Run the compiled RevaHub server |
| `npm run lint` | Lint everything |
| `npm run lint:fix` | Lint and auto-fix |

---

## Package Development

### Modules

A module is an npm package named `revahub-module-<name>`. It exports a factory function that receives a `ModuleContext` and returns a running instance object.

```ts
import type { ModuleContext } from 'revahub-types';

export default async (ctx: ModuleContext) => {
  // Initialize service connection using ctx.options
  ctx.onDestroy(() => { /* cleanup */ });
  return instance; // public methods are auto-detected
};
```

The `package.json` must include a `"revahub"` block with `type: "module"`, a `label`, and an `options` array describing the configuration fields.

Example package.json:
```json
{
  "name": "revahub-module-steam",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "revahub": {
    "type": "module",
    "label": "Steam",
    "description": "Steam Web API integration",
    "options": [
      {
        "key": "apiKey",
        "label": "API Key",
        "type": "string",
        "required": true
      }
    ]
  }
}
```

### Tasks

A task is an npm package named `revahub-task-<name>`. It exports a single async function:

```ts
import type { TaskContext } from 'revahub-types';

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
| `webhook` | `POST /webhooks/:taskId` |

### Package Installation Methods

| Method | Source Type | Use Case |
|---|---|---|
| `npm install` in `~/.revahub/` | `npm` | Standard npm packages |
| Git URL in package.json | `git` | Private repos or unreleased versions |
| Local directory symlink | `local` | Development and testing |
| Dashboard import form | `local` | One-off custom packages |

## Architecture

```
revahub (single Node.js process)
│
├── PGlite Database (embedded WebAssembly PostgreSQL)
│
├── Package Scanner (filesystem-based discovery)
│     ├── ~/.revahub/node_modules/ (npm/git packages)
│     ├── ~/.revahub/packages/ (default local packages)
│     └── Custom local directory (optional)
│
├── Package Watcher (chokidar hot-reload)
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
└── HTTP Server (Fastify)
      └── Vue 3 + Vuetify SPA (pre-built, served as static files)
```

## Native Packages

The following packages ship pre-installed and are automatically detected from `revahub`'s own dependencies. They cannot be uninstalled:

| Package | Type | Description |
|---|---|---|
| `revahub-module-database` | Module | PGlite database access; auto-injected as `ctx.instances.database` with dual-mode (shared or isolated schema) |
| `revahub-module-logger` | Module | Structured logging; auto-injected as `ctx.instances.logger` |
| `revahub-task-cleanup-logs` | Task | Deletes log entries older than a configured age |

To add new native packages, simply add them as dependencies in `packages/revahub/package.json` and they'll be automatically detected at runtime.

## Monorepo Structure

This repository is an npm workspace monorepo. Packages are organized as follows:

```
packages/
  revahub/              # Core platform, HTTP server, CLI
  revahub-types/        # Shared TypeScript types
  revahub-ui/           # Vue 3 + Vuetify dashboard (builds to revahub/dist/ui/)
  revahub-module-database/    # Native database module
  revahub-module-logger/      # Native logger module
  revahub-task-cleanup-logs/  # Native cleanup task
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
