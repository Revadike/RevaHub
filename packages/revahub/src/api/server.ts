import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
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

  await app.register(fastifyWebsocket);

  // Serve pre-built Vue SPA
  const uiDir = join(__dirname, '..', 'ui');
  await app.register(fastifyStatic, {
    root: uiDir,
    prefix: '/',
    wildcard: false
  });

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

  // SPA fallback — serve index.html for client-side routing
  app.setNotFoundHandler((_req, reply) => {
    return reply.sendFile('index.html');
  });

  return app;
}
