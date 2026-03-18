import type { FastifyInstance } from 'fastify';
import type { ServerDeps } from '../server.js';
import { getPackageRegistry, scanAllPackages, registerPackage, deregisterPackage } from '../../core/package-scanner.js';
import { installPackage, uninstallPackage } from '../../cli/commands.js';
import { getNativePackages } from '../../utils/native-packages.js';
import { join } from 'node:path';

/**
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 * @returns
 */
export function registerPackageRoutes(app: FastifyInstance, deps: ServerDeps) {
  // Get all packages in registry
  app.get('/packages', async () => {
    const registry = getPackageRegistry();
    return Array.from(registry.values());
  });

  // Rescan all packages
  app.post('/packages/rescan', async () => {
    const nativePackages = getNativePackages();
    await scanAllPackages({
      workingDir: deps.workingDir,
      localPackagesDir: null,
      nativePackages
    });
    const registry = getPackageRegistry();
    return { count: registry.size, packages: Array.from(registry.values()) };
  });

  // Install package from npm
  app.post<{ Body: { name: string; version?: string } }>('/packages/install', async (request, reply) => {
    const { name, version } = request.body;
    if (!name) {
      return reply.status(400).send({ error: 'Package name is required' });
    }

    try {
      const nativePackages = getNativePackages();
      await installPackage(name, { version, workingDir: deps.workingDir }, nativePackages);
      // Re-register after install
      const pkgPath = join(deps.workingDir, 'node_modules', name);
      await registerPackage(pkgPath, 'npm', nativePackages);
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
      const nativePackages = getNativePackages();
      await uninstallPackage(name, { workingDir: deps.workingDir }, nativePackages);
      // Deregister after uninstall
      deregisterPackage(name);
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
      const nativePackages = getNativePackages();
      // For local packages, we use the path directly
      const entry = await registerPackage(path, 'local', nativePackages);
      if (!entry) {
        return reply.status(404).send({ error: 'Invalid package at path' });
      }

      return { success: true, package: entry };
    } catch (err) {
      return reply.status(500).send({ error: (err as Error).message });
    }
  });
}
