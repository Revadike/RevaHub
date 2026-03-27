import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import Fastify from 'fastify';

import { registerLogStreamRoutes } from './routes/log-stream.js';
import { registerLogRoutes } from './routes/logs.js';
import { registerMarketplaceRoutes } from './routes/marketplace.js';
import { registerModuleRoutes } from './routes/modules.js';
import { registerPackageRoutes } from './routes/packages.js';
import { registerSettingsRoutes } from './routes/settings.js';
import { registerTaskRoutes } from './routes/tasks.js';
import { registerWebhookRoutes } from './routes/webhooks.js';
import type { ModuleManager } from '../core/module-manager.js';
import type { PackageScanner } from '../core/package-scanner.js';
import type { PackageWatcher } from '../core/package-watcher.js';
import type { TaskRunner } from '../core/task-runner.js';
import { isDev } from '../utils/environment.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface ServerDeps {
  moduleManager: ModuleManager;
  taskRunner: TaskRunner;
  workingDir: string;
  scanner: PackageScanner;
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
  const app = Fastify({
    logger: true,
    // Force close connections immediately on shutdown in dev mode
    // This prevents "port already in use" errors during hot reload
    forceCloseConnections: isDev
  });

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
  if (!isDev && existsSync(uiDir)) {
    await app.register(fastifyStatic, {
      root: uiDir,
      prefix: '/',
      wildcard: false
    });

    // SPA fallback — serve index.html for client-side routing
    app.setNotFoundHandler((_req, reply) => {
      return reply.sendFile('index.html');
    });
  } else if (!isDev) {
    throw new Error('UI directory not found. Please build the UI before starting the server in production mode.');
  }

  // In development, Vite serves the UI on port 3000 with HMR
  return app;
}
