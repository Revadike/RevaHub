import { eq, desc } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { getDatabase } from '../../db/index.js';
import { tasks, taskConfigs, taskRuns } from '../../db/schema.js';
import { resolvePackagePath, scanPackage } from '../../core/package-scanner.js';
import type { ServerDeps } from '../server.js';
import type { FastifyInstance } from 'fastify';

/**
 * Registers all task and task config API routes.
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerTaskRoutes(app: FastifyInstance, deps: ServerDeps) {
  // List all tasks
  app.get('/tasks', async () => {
    const db = getDatabase();
    return db.select().from(tasks);
  });

  // Get a single task
  app.get<{ Params: { name: string } }>('/tasks/:name', async (req, reply) => {
    const db = getDatabase();
    const [task] = await db.select().from(tasks)
      .where(eq(tasks.name, req.params.name));
    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    return task;
  });

  // Get option definitions for a task
  app.get<{ Params: { name: string } }>('/tasks/:name/options', async (req, reply) => {
    try {
      const packageDir = await resolvePackagePath(req.params.name, deps.workingDir);
      const scanned = await scanPackage(packageDir);
      if (!scanned) {
        return reply.code(404).send({ error: 'Task package not found' });
      }

      return scanned.revahub.options ?? [];
    } catch {
      return reply.code(404).send({ error: 'Task package not found' });
    }
  });

  // List all task configs
  app.get('/task-configs', async () => {
    const db = getDatabase();
    return db.select().from(taskConfigs);
  });

  // List configs for a specific task
  app.get<{ Params: { name: string } }>('/tasks/:name/configs', async (req) => {
    const db = getDatabase();
    return db.select().from(taskConfigs)
      .where(eq(taskConfigs.taskName, req.params.name));
  });

  // Get a single task config
  app.get<{ Params: { id: string } }>('/task-configs/:id', async (req, reply) => {
    const db = getDatabase();
    const [config] = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.id, req.params.id));
    if (!config) {
      return reply.code(404).send({ error: 'Task config not found' });
    }

    return config;
  });

  // Create a new task config
  app.post<{ Body: { taskName: string; label: string; options?: Record<string, unknown>; enabled?: boolean } }>(
    '/task-configs',
    async (req, reply) => {
      const db = getDatabase();
      const { taskName, label, options = {}, enabled = true } = req.body;

      const [task] = await db.select().from(tasks)
        .where(eq(tasks.name, taskName));
      if (!task) {
        return reply.code(400).send({ error: 'Task not found' });
      }

      const id = `tc_${randomBytes(3).toString('hex')}`;
      await db.insert(taskConfigs).values({ id, taskName, label, options, enabled });

      // Refresh cron jobs in case this config has a cron trigger
      await deps.taskRunner.refreshCronJobs();

      return reply.code(201).send({ id, taskName, label, options, enabled });
    }
  );

  // Update a task config
  app.patch<{ Params: { id: string }; Body: Partial<{ label: string; options: Record<string, unknown>; enabled: boolean }> }>(
    '/task-configs/:id',
    async (req, reply) => {
      const db = getDatabase();
      const [existing] = await db.select().from(taskConfigs)
        .where(eq(taskConfigs.id, req.params.id));
      if (!existing) {
        return reply.code(404).send({ error: 'Task config not found' });
      }

      await db.update(taskConfigs).set(req.body)
        .where(eq(taskConfigs.id, req.params.id));
      await deps.taskRunner.refreshCronJobs();
      return { success: true };
    }
  );

  // Delete a task config
  app.delete<{ Params: { id: string } }>('/task-configs/:id', async (req, reply) => {
    const db = getDatabase();
    const [existing] = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.id, req.params.id));
    if (!existing) {
      return reply.code(404).send({ error: 'Task config not found' });
    }

    await db.delete(taskConfigs).where(eq(taskConfigs.id, req.params.id));
    await deps.taskRunner.refreshCronJobs();
    return { success: true };
  });

  // Manually trigger a task run
  app.post<{ Params: { id: string } }>('/task-configs/:id/run', async (req, reply) => {
    try {
      const result = await deps.taskRunner.invoke(req.params.id, 'manual');
      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });

  // List task runs (optionally filtered by task config)
  app.get<{ Querystring: { taskConfigId?: string; limit?: string } }>('/task-runs', async (req) => {
    const db = getDatabase();
    const limit = Math.min(parseInt(req.query.limit ?? '50', 10), 200);

    if (req.query.taskConfigId) {
      return db.select().from(taskRuns)
        .where(eq(taskRuns.taskConfigId, req.query.taskConfigId))
        .orderBy(desc(taskRuns.startedAt))
        .limit(limit);
    }

    return db.select().from(taskRuns)
      .orderBy(desc(taskRuns.startedAt))
      .limit(limit);
  });

  // Get a single task run
  app.get<{ Params: { id: string } }>('/task-runs/:id', async (req, reply) => {
    const db = getDatabase();
    const [run] = await db.select().from(taskRuns)
      .where(eq(taskRuns.id, req.params.id));
    if (!run) {
      return reply.code(404).send({ error: 'Task run not found' });
    }

    return run;
  });
}
