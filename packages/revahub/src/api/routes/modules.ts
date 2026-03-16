import { eq } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../db/index.js';
import { modules, moduleInstances } from '../../db/schema.js';
import { resolvePackagePath, scanPackage } from '../../core/package-scanner.js';
import type { ServerDeps } from '../server.js';
import type { FastifyInstance } from 'fastify';

/**
 * Registers all module and module instance API routes.
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerModuleRoutes(app: FastifyInstance, deps: ServerDeps) {
  // List all modules
  app.get('/modules', async () => {
    const db = getDatabase();
    return db.select().from(modules);
  });

  // Get a single module
  app.get<{ Params: { name: string } }>('/modules/:name', async (req, reply) => {
    const db = getDatabase();
    const [mod] = await db.select().from(modules)
      .where(eq(modules.name, req.params.name));
    if (!mod) {
      return reply.code(404).send({ error: 'Module not found' });
    }

    return mod;
  });

  // Get option definitions for a module
  app.get<{ Params: { name: string } }>('/modules/:name/options', async (req, reply) => {
    try {
      const packageDir = await resolvePackagePath(req.params.name, deps.workingDir);
      const scanned = await scanPackage(packageDir);
      if (!scanned) {
        return reply.code(404).send({ error: 'Module package not found' });
      }

      return scanned.revahub.options ?? [];
    } catch {
      return reply.code(404).send({ error: 'Module package not found' });
    }
  });

  // List all instances
  app.get('/instances', async () => {
    const db = getDatabase();
    return db.select().from(moduleInstances);
  });

  // List instances for a specific module
  app.get<{ Params: { name: string } }>('/modules/:name/instances', async (req) => {
    const db = getDatabase();
    return db.select().from(moduleInstances)
      .where(eq(moduleInstances.moduleName, req.params.name));
  });

  // Get a single instance
  app.get<{ Params: { id: string } }>('/instances/:id', async (req, reply) => {
    const db = getDatabase();
    const [instance] = await db.select().from(moduleInstances)
      .where(eq(moduleInstances.id, req.params.id));
    if (!instance) {
      return reply.code(404).send({ error: 'Instance not found' });
    }

    return instance;
  });

  // Create a new instance
  app.post<{ Body: { moduleName: string; label: string; options?: Record<string, unknown>; enabled?: boolean } }>(
    '/instances',
    async (req, reply) => {
      const db = getDatabase();
      const { moduleName, label, options = {}, enabled = true } = req.body;

      const [mod] = await db.select().from(modules)
        .where(eq(modules.name, moduleName));
      if (!mod) {
        return reply.code(400).send({ error: 'Module not found' });
      }

      const id = `inst_${randomBytes(3).toString('hex')}`;
      await db.insert(moduleInstances).values({ id, moduleName, label, options, enabled });

      if (enabled) {
        try {
          await deps.moduleManager.startInstance(id);
        } catch (err) {
          console.error(`[API] Failed to start new instance "${id}":`, err);
        }
      }

      return reply.code(201).send({ id, moduleName, label, options, enabled, status: 'stopped' });
    }
  );

  // Update an instance
  app.patch<{ Params: { id: string }; Body: Partial<{ label: string; options: Record<string, unknown>; enabled: boolean; autoRestart: boolean }> }>(
    '/instances/:id',
    async (req, reply) => {
      const db = getDatabase();
      const [existing] = await db.select().from(moduleInstances)
        .where(eq(moduleInstances.id, req.params.id));
      if (!existing) {
        return reply.code(404).send({ error: 'Instance not found' });
      }

      await db.update(moduleInstances).set(req.body)
        .where(eq(moduleInstances.id, req.params.id));
      return { success: true };
    }
  );

  // Delete an instance
  app.delete<{ Params: { id: string } }>('/instances/:id', async (req, reply) => {
    const db = getDatabase();
    const [existing] = await db.select().from(moduleInstances)
      .where(eq(moduleInstances.id, req.params.id));
    if (!existing) {
      return reply.code(404).send({ error: 'Instance not found' });
    }

    // Prevent deleting native default instances
    const [mod] = await db.select().from(modules)
      .where(eq(modules.name, existing.moduleName));
    if (mod?.native) {
      return reply.code(403).send({ error: 'Cannot delete native module default instance' });
    }

    await deps.moduleManager.stopInstance(req.params.id);
    await db.delete(moduleInstances).where(eq(moduleInstances.id, req.params.id));
    return { success: true };
  });

  // Start an instance
  app.post<{ Params: { id: string } }>('/instances/:id/start', async (req, reply) => {
    try {
      await deps.moduleManager.startInstance(req.params.id);
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // Stop an instance
  app.post<{ Params: { id: string } }>('/instances/:id/stop', async (req) => {
    await deps.moduleManager.stopInstance(req.params.id);
    return { success: true };
  });

  // Restart an instance
  app.post<{ Params: { id: string } }>('/instances/:id/restart', async (req, reply) => {
    try {
      await deps.moduleManager.stopInstance(req.params.id);
      await deps.moduleManager.startInstance(req.params.id);
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}
