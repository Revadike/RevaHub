# RevaHub

A self-hosted, event-driven automation platform with a plugin-based module and task ecosystem. Written in TypeScript, distributed via npm, managed through a web dashboard.

## Features

* **Modules** — Run persistent module instances in their own worker threads.

* **Tasks** — Define and run short-lived asynchronous automation workflows.

* **Embedded database** — Persist state and data without requiring external infrastructure.

* **Web dashboard** — Configure, manage, and observe the system from a single interface.

* **Dynamic UI** — Generate forms dynamically from package configuration schemas.

* **Real-time logging** — Stream logs from modules and task runs for monitoring and debugging.

* **Integrated marketplace** — Discover, install, update, and remove modules and tasks.

* **Modular architecture** — Install and manage modules and tasks as standard npm packages.

* **Event-driven automation** — Trigger tasks from events, schedules, webhooks, or manual execution.

* **Built-in event bus** — Enable communication between modules and tasks through a decoupled messaging layer.

## Prerequisites

- [Node.js 22+](https://nodejs.org/)

## Quick Start

```sh
npm install -g revahub
revahub
```

Or without a global install:

```sh
npx revahub
```

On first run, RevaHub will:
- Create `~/.revahub/` directory structure
- Initialize PGlite database
- Run migrations
- Register native packages
- Start HTTP server on port 3000

Open http://localhost:3000 to access the dashboard.

## Development

```sh
git clone https://github.com/Revadike/RevaHub.git
cd RevaHub
npm install
```

## Scripts

| Script             | Description                                        |
| ------------------ | -------------------------------------------------- |
| `npm run build`    | Compile all TypeScript packages                    |
| `npm run build:ui` | Build the Vue SPA into `packages/revahub/dist/ui/` |
| `npm run dev`      | Watch-mode TypeScript compilation                  |
| `npm start`        | Run the compiled RevaHub server                    |
| `npm run lint`     | Lint everything                                    |
| `npm run lint:fix` | Lint and auto-fix                                  |

## CLI Commands

```sh
revahub start                          # Start the server (default command)
revahub create module <name>           # Scaffold a new module package
revahub create task <name>             # Scaffold a new task package
revahub install module <name>          # Install a module from npm
revahub install task <name>            # Install a task from npm
revahub uninstall module <name>        # Uninstall a module
revahub uninstall task <name>          # Uninstall a task
```

## Modules

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
  "name": "revahub-module-steam-api",
  "version": "1.0.0",
  "type": "module",
  "main": "dist/index.js",
  "revahub": {
    "type": "module",
    "label": "Steam API",
    "description": "Steam Web API integration",
    "options": [
      {
        "key": "apiKey",
        "label": "API Key",
        "type": "secret",
        "required": true
      }
    ]
  }
}
```

## Tasks

A task is an npm package named `revahub-task-<name>`. It exports a single async function:

```ts
import type { TaskContext } from 'revahub-types';

export default async (ctx: TaskContext) => {
  const result = await ctx.instances.myInstance.doSomething();
  return result;
};
```

## Triggers

| Trigger   | Description                                      |
| --------- | ------------------------------------------------ |
| `cron`    | Fired on a cron schedule                         |
| `event`   | Fired when a module instance emits a named event |
| `manual`  | User clicks **Run** in the dashboard             |
| `webhook` | `POST /webhooks/:taskId`                         |

## Architecture

```
revahub (single Node.js process)
│
├── PGlite Database (embedded WebAssembly PostgreSQL)
│
├── Package Scanner (filesystem-based discovery)
│     ├── ~/.revahub/node_modules/ (npm/git packages)
│     └── ~/.revahub/packages/ (symlinked local packages)
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

| Package                     | Type   | Description                                                                                                  |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| `revahub-module-database`   | Module | PGlite database access; auto-injected as `ctx.instances.database` with dual-mode (shared or isolated schema) |
| `revahub-module-logger`     | Module | Structured logging; auto-injected as `ctx.instances.logger`                                                  |
| `revahub-task-cleanup-logs` | Task   | Deletes log entries older than a configured age                                                              |


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

## Tech Stack

| Concern          | Choice                 |
| ---------------- | ---------------------- |
| Runtime          | Node.js LTS            |
| Language         | TypeScript             |
| HTTP server      | Fastify                |
| Frontend         | Vue 3 + Vuetify + Vite |
| Database         | PostgreSQL             |
| ORM              | Drizzle ORM            |
| Module isolation | `node:worker_threads`  |
| Cron             | `node-cron`            |

## License

Apache-2.0 — see [LICENSE.txt](LICENSE.txt).
