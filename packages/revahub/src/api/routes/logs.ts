import { eq, desc } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { getDatabase } from '../../db/index.js';
import { logs } from '../../db/schema.js';

/**
 * Registers log viewing API routes.
 *
 * @param app - Fastify instance scoped to /api
 */
export function registerLogRoutes(app: FastifyInstance) {
  // List logs (with optional filters)
  app.get<{ Querystring: { taskRunId?: string; moduleInstanceId?: string; limit?: string } }>(
    '/logs',
    async (req) => {
      const db = getDatabase();
      const limit = Math.min(parseInt(req.query.limit ?? '100', 10), 500);

      if (req.query.taskRunId) {
        return db.select().from(logs)
          .where(eq(logs.taskRunId, req.query.taskRunId))
          .orderBy(desc(logs.timestamp))
          .limit(limit);
      }

      if (req.query.moduleInstanceId) {
        return db.select().from(logs)
          .where(eq(logs.moduleInstanceId, req.query.moduleInstanceId))
          .orderBy(desc(logs.timestamp))
          .limit(limit);
      }

      return db.select().from(logs)
        .orderBy(desc(logs.timestamp))
        .limit(limit);
    }
  );
}
