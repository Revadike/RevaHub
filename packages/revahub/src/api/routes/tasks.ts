import { randomBytes } from 'node:crypto';

import { eq, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { getDatabase } from '../../db/index.js';
import { tasks, taskRuns } from '../../db/schema.js';
import type { ServerDeps } from '../server.js';

/**
 * Registers all task and task config API routes.
 *
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerTaskRoutes(app: FastifyInstance, deps: ServerDeps) {
  // List all task packages (from registry)
  app.get('/task-packages', async () => {
    const registry = deps.scanner.getRegistry();
    const taskPackages = [];
    for (const entry of registry.values()) {
      if (entry.type === 'task') {
        taskPackages.push({
          name: entry.name,
          version: entry.version,
          label: entry.label,
          source: entry.source,
          native: entry.native
        });
      }
    }
    return taskPackages;
  });

  // Get a single task package
  app.get<{ Params: { name: string } }>('/task-packages/:name', async (req, reply) => {
    const pkg = deps.scanner.getPackage(req.params.name);
    if (!pkg || pkg.type !== 'task') {
      return reply.code(404).send({ error: 'Task package not found' });
    }

    return {
      name: pkg.name,
      version: pkg.version,
      label: pkg.label,
      source: pkg.source,
      native: pkg.native
    };
  });

  // Get option definitions for a task package
  app.get<{ Params: { name: string } }>('/task-packages/:name/options', async (req, reply) => {
    try {
      const packageDir = await deps.scanner.resolvePackagePath(req.params.name, deps.workingDir);
      const scanned = await deps.scanner.scanPackage(packageDir);
      if (!scanned) {
        return reply.code(404).send({ error: 'Task package not found' });
      }

      return scanned.revahub.options ?? [];
    } catch {
      return reply.code(404).send({ error: 'Task package not found' });
    }
  });

  // List all configured tasks (formerly task-configs, now stored in tasks table)
  app.get('/tasks', async () => {
    const db = getDatabase();
    return db.select().from(tasks);
  });

  // List configs for a specific task package
  app.get<{ Params: { name: string } }>('/task-packages/:name/tasks', async (req) => {
    const db = getDatabase();
    return db
      .select()
      .from(tasks)
      .where(eq(tasks.taskName, req.params.name));
  });

  // Get a single configured task
  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const db = getDatabase();
    const [task] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, req.params.id));

    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // Create a new configured task
  app.post<{ Body: { taskName: string; label: string; options?: Record<string, unknown>; enabled?: boolean } }>(
    '/tasks',
    async (req, reply) => {
      const { taskName, label, options = {}, enabled = true } = req.body;

      // Check task package exists in registry
      const pkg = deps.scanner.getPackage(taskName);
      if (!pkg || pkg.type !== 'task') {
        return reply.code(400).send({ error: 'Task package not found' });
      }

      const db = getDatabase();
      const id = `task_${randomBytes(3).toString('hex')}`;
      await db.insert(tasks).values({ id, taskName, label, options, enabled });

      // Refresh cron jobs in case this task has a cron trigger
      await deps.taskRunner.refreshCronJobs();

      return reply.code(201).send({ id, taskName, label, options, enabled });
    }
  );

  // Update a configured task
  app.patch<{ Params: { id: string }; Body: Partial<{ label: string; options: Record<string, unknown>; enabled: boolean }> }>(
    '/tasks/:id',
    async (req, reply) => {
      const db = getDatabase();
      const [existing] = await db
        .select()
        .from(tasks)
        .where(eq(tasks.id, req.params.id));

      if (!existing) {
        return reply.code(404).send({ error: 'Task not found' });
      }

      await db
        .update(tasks)
        .set(req.body)
        .where(eq(tasks.id, req.params.id));

      await deps.taskRunner.refreshCronJobs();
      return { success: true };
    }
  );

  // Delete a configured task
  app.delete<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const db = getDatabase();
    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, req.params.id));

    if (!existing) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    await db.delete(tasks).where(eq(tasks.id, req.params.id));
    await deps.taskRunner.refreshCronJobs();
    return { success: true };
  });

  // Manually trigger a task run
  app.post<{ Params: { id: string } }>('/tasks/:id/run', async (req, reply) => {
    try {
      const result = await deps.taskRunner.invoke(req.params.id, 'manual');

      // If the TaskRunner returned an error payload, surface it as HTTP 500
      if (result && 'error' in result && (result as { error?: unknown }).error) {
        return reply.code(500).send(result);
      }

      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // List task runs (optionally filtered by task)
  app.get<{ Querystring: { taskId?: string; limit?: string } }>('/task-runs', async (req) => {
    const db = getDatabase();
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);

    if (req.query.taskId) {
      return db
        .select()
        .from(taskRuns)
        .where(eq(taskRuns.taskId, req.query.taskId))
        .orderBy(desc(taskRuns.startedAt))
        .limit(limit);
    }

    return db
      .select()
      .from(taskRuns)
      .orderBy(desc(taskRuns.startedAt))
      .limit(limit);
  });

  // Get a single task run
  app.get<{ Params: { id: string } }>('/task-runs/:id', async (req, reply) => {
    const db = getDatabase();
    const [run] = await db
      .select()
      .from(taskRuns)
      .where(eq(taskRuns.id, req.params.id));

    if (!run) {
      return reply.code(404).send({ error: 'Task run not found' });
    }

    return run;
  });
}
