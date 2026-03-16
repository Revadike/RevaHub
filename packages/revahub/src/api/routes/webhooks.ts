import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { getDatabase } from '../../db/index.js';
import { taskConfigs } from '../../db/schema.js';
import type { ServerDeps } from '../server.js';
import type { TaskConfigOptions } from '../../types.js';

/**
 * Registers webhook routes for task configs that have `exposeWebhook` enabled.
 * Routes are registered at POST /webhooks/:taskConfigId.
 * @param app - Root Fastify instance
 * @param deps - Core service dependencies
 */
export function registerWebhookRoutes(app: FastifyInstance, deps: ServerDeps) {
  app.post<{ Params: { taskConfigId: string } }>('/webhooks/:taskConfigId', async (req, reply) => {
    const db = getDatabase();
    const [config] = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.id, req.params.taskConfigId));

    if (!config) {
      return reply.code(404).send({ error: 'Task config not found' });
    }

    const options = config.options as TaskConfigOptions;
    if (!options.exposeWebhook) {
      return reply.code(404).send({ error: 'Webhook not enabled for this task config' });
    }

    try {
      const result = await deps.taskRunner.invoke(
        req.params.taskConfigId,
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
