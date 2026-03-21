import { join } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { installPackage, uninstallPackage } from '../../cli/commands.js';
import type { ServerDeps } from '../server.js';

/**
 * Registers package management routes.
 *
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerPackageRoutes(app: FastifyInstance, deps: ServerDeps) {
  // Get all packages in registry
  app.get('/packages', async () => {
    const registry = deps.scanner.getRegistry();
    return Array.from(registry.values());
  });

  // Rescan all packages
  app.post('/packages/rescan', async () => {
    await deps.scanner.scanAll({
      workingDir: deps.workingDir,
      localPackagesDir: null
    });
    await deps.scanner.ensureNativePackages(deps.workingDir);
    const registry = deps.scanner.getRegistry();
    return { count: registry.size, packages: Array.from(registry.values()) };
  });

  // Install package from npm
  app.post<{ Body: { name: string; version?: string } }>('/packages/install', async (request, reply) => {
    const { name, version } = request.body;
    if (!name) {
      return reply.status(400).send({ error: 'Package name is required' });
    }

    try {
      await installPackage(name, deps.scanner, { version, workingDir: deps.workingDir });
      // Re-register after install
      const pkgPath = join(deps.workingDir, 'node_modules', name);
      await deps.scanner.registerPackage(pkgPath, 'npm');
      return { success: true, name };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // Uninstall package
  app.post<{ Body: { name: string } }>('/packages/uninstall', async (request, reply) => {
    const { name } = request.body;
    if (!name) {
      return reply.status(400).send({ error: 'Package name is required' });
    }

    try {
      await uninstallPackage(name, deps.scanner, { workingDir: deps.workingDir });
      // Deregister after uninstall
      deps.scanner.deregisterPackage(name);
      return { success: true, name };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // Register local package by path
  app.post<{ Body: { path: string } }>('/packages/register-local', async (request, reply) => {
    const { path } = request.body;
    if (!path) {
      return reply.status(400).send({ error: 'Package path is required' });
    }

    try {
      const entry = await deps.scanner.registerPackage(path, 'local');
      if (!entry) {
        return reply.status(404).send({ error: 'Invalid package at path' });
      }

      return { success: true, package: entry };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
