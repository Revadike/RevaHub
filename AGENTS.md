# RevaHub

You are an AI programming agent tasked with developing and maintaining the **core framework, architecture, and native packages** of RevaHub (a Node.js/TypeScript event-driven automation platform). **Do not** focus on developing external or 3rd-party modules/tasks. Your priority is framework stability, performance, and architectural integrity.

## Architecture
RevaHub operates as a single Node.js process managing crash-isolated worker threads. It is an npm workspace monorepo structured as follows:
* **`revahub/`**: Core platform, HTTP server (Fastify), package scanner/watcher, module manager, and CLI.
* **`revahub-types/`**: Shared TypeScript definitions.
* **`revahub-ui/`**: Vue 3 + Vuetify dashboard (Vite dev server on port 3000, proxies `/api`, `/webhooks`, `/ws` to port 3001). UI forms are generated dynamically from module configuration schemas.
* **Native Packages**: Pre-installed and un-removable.
    * `revahub-module-database`: PGlite embedded WebAssembly Postgres (dual-mode: shared/isolated schema). Auto-injected as `ctx.instances.database`.
    * `revahub-module-logger`: Structured real-time logging. Auto-injected as `ctx.instances.logger`.
    * `revahub-task-cleanup-logs`: Native cleanup task.

**System Mechanics:**
* **Event Bus:** A built-in decoupled messaging layer (EventEmitter) enabling communication between modules and tasks.
* **Triggers:** Tasks execute via `cron` (node-cron), `event` (module instance emissions), `webhook` (POST routes), or `manual` execution.
* **Package Config:** Modules define their UI and requirements in `package.json` under a `"revahub"` block (requires `type`, `label`, and an `options` array).

---

## MCP Servers
Always leverage your available MCP tools to make informed, data-driven decisions before writing code.

### 1. `context7` (Documentation Engine)
**Purpose:** Eliminates AI hallucinations and outdated training data.
**How it works:** This MCP server fetches real-time, version-specific documentation and code examples directly from official sources. 
**Usage:** Use tools like `resolve-library-id` and `query-docs` to look up the most up-to-date APIs, quickstarts, and best practices for our stack (Fastify, Drizzle ORM, PGlite, Vue 3) before implementing core logic.

### 2. `chrome-devtools-mcp` (Frontend Testing & Debugging)
**Purpose:** Live browser inspection and UI validation.
**How it works:** Acts as a bridge to the Chrome DevTools Protocol, allowing you to control and inspect a live Chrome browser instance. 
**Usage:** Use this to interact with the RevaHub Vue SPA (`http://localhost:3000`). You can inspect the DOM, monitor network requests to the Fastify backend, read real-time console errors, navigate, take screenshots, and verify dynamic form rendering. 

### 3. `firecrawl` (Architectural Research & Web Scraping)
**Purpose:** Deep research and structured data extraction.
**How it works:** A powerful scraping engine that bypasses anti-bot protections, renders JavaScript, and converts messy web pages into clean markdown or structured JSON. 
**Usage:** Use tools like `search`, `scrape`, and `map` to research modern system design choices, alternative architectural approaches, or specific Node.js/worker-thread patterns across the broader web.

---

## Standards
* **Quality & Best Practices:** Do not cut corners. Adhere strictly to modern standards. Continually question if the current implementation is the optimal way to solve the problem; refactor if necessary.
* **Strict Typing:** Use proper TypeScript types universally. The use of `any` is strictly prohibited.
* **DRY Principle:** Vigorously reuse existing exported functions and utilities. Adapt existing code rather than duplicating logic.
* **Documentation:** Write standard `TSDoc` blocks for all exported and reusable functions. Keep internal comments sparse and strictly functional. Only comment to clarify non-obvious logic. **Never** use stylized or formatting comments (e.g., `// -------`).

### Task Lifecycle
1.  **Research:** Query `context7` for API syntax and `firecrawl` for architectural patterns.
2.  **Implement:** Write robust, typed, and DRY code.
3.  **Test:** Use `chrome-devtools-mcp` to validate UI components and API network requests.
4.  **Format:** Run `npm run lint:fix` to auto-format and manually resolve any lingering issues.
5.  **Self-Review (Mandatory):** Critically analyze your completed work. Identify and immediately fix any logic flaws. Explicitly note any architectural trade-offs or remaining concerns in your output.
6.  **Documentation Sync:** If your changes alter the platform's architecture, dependencies, or core logic, update `README.md` and this `AGENTS.md` file to reflect accurate, current state.