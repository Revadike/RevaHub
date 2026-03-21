import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { registerModuleRoutes } from './routes/modules.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerLogStreamRoutes } from './routes/log-stream.js';
import { registerPackageRoutes } from './routes/packages.js';
import type { ModuleManager } from '../core/module-manager.js';
import type { TaskRunner } from '../core/task-runner.js';
import type { PackageWatcher } from '../core/package-watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerDeps {
  moduleManager: ModuleManager;
  taskRunner: TaskRunner;
  workingDir: string;
  nativePackages: Set<string>;
  packageWatcher?: PackageWatcher;
}

/**
 * Creates and configures the Fastify HTTP server with all API routes,
 * WebSocket support, and static file serving for the Vue SPA.
 *
 * @param deps - Core service dependencies
 * @returns Configured Fastify server instance
 */
export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  // TODO: Implement global error handler via setErrorHandler?

  await app.register(fastifyWebsocket);

  // API routes
  await app.register(
    async (api) => {
      registerPackageRoutes(api, deps);
      registerModuleRoutes(api, deps);
      registerTaskRoutes(api, deps);
      registerLogRoutes(api);
      registerSettingsRoutes(api);
      registerMarketplaceRoutes(api, deps);
    },
    { prefix: '/api' }
  );

  // Webhook routes
  registerWebhookRoutes(app, deps);

  // WebSocket log streaming
  registerLogStreamRoutes(app);

  // Serve pre-built Vue SPA (production mode only)
  const uiDir = join(__dirname, '..', 'ui');
  if (existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: '/',
      wildcard: false
    });

    // SPA fallback — serve index.html for client-side routing
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile('index.html');
    });
  } else {
    app.log.info('UI directory not found - running in dev mode. Frontend should be on port 3000.');
  }

  return app;
}
