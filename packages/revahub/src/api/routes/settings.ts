import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { getDatabase } from '../../db/index.js';
import { settings } from '../../db/schema.js';

/**
 * Registers settings API routes.
 *
 * @param app - Fastify instance scoped to /api
 */
export function registerSettingsRoutes(app: FastifyInstance) {
  // Get all settings
  app.get('/settings', async () => {
    const db = getDatabase();
    return db.select().from(settings);
  });

  // Get a single setting by key
  app.get<{ Params: { key: string } }>('/settings/:key', async (req, reply) => {
    const db = getDatabase();
    const [setting] = await db.select().from(settings)
      .where(eq(settings.key, req.params.key));
    if (!setting) {
      return reply.code(404).send({ error: 'Setting not found' });
    }

    return setting;
  });

  // Upsert a setting
  app.put<{ Params: { key: string }; Body: { value: unknown } }>('/settings/:key', async (req) => {
    const db = getDatabase();
    const { key } = req.params;
    const { value } = req.body;

    await db.insert(settings)
      .values({ key, value: value as object })
      .onConflictDoUpdate({ target: settings.key, set: { value: value as object } });

    return { key, value };
  });
}
