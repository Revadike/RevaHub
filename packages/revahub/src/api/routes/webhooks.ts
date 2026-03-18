import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../db/index.js';
import { tasks } from '../../db/schema.js';
import type { ServerDeps } from '../server.js';

interface TaskOptions {
  exposeWebhook?: boolean;
}

/**
 * Registers webhook routes for task configs that have `exposeWebhook` enabled.
 * Routes are registered at POST /webhooks/:taskConfigId.
 *
 * @param app - Root Fastify instance
 * @param deps - Core service dependencies
 */
export function registerWebhookRoutes(app: FastifyInstance, deps: ServerDeps) {
  app.post<{ Params: { taskId: string } }>('/webhooks/:taskId', async (req, reply) => {
    const db = getDatabase();
    const [task] = await db.select().from(tasks)
      .where(eq(tasks.id, req.params.taskId));

    if (!task) {
      return reply.code(404).send({ error: 'Task not found' });
    }

    const options = task.options as TaskOptions | undefined;
    if (!options?.exposeWebhook) {
      return reply.code(404).send({ error: 'Webhook not enabled for this task' });
    }

    try {
      const result = await deps.taskRunner.invoke(
        req.params.taskId,
        'webhook',
        undefined,
        req.body
      );

      return result;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Unknown error' });
    }
  });
}
