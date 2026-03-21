import { eq, gt, desc, and } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { getDatabase } from '../../db/index.js';
import { logs } from '../../db/schema.js';

const POLL_INTERVAL_MS = 1000;

/**
 * Registers WebSocket routes for live log streaming.
 * Clients connect and optionally subscribe to logs filtered by instance or task run.
 *
 * @param app - Root Fastify instance (not under /api prefix)
 */
export function registerLogStreamRoutes(app: FastifyInstance) {
  app.get<{ Querystring: { moduleInstanceId?: string; taskRunId?: string } }>(
    '/ws/logs',
    { websocket: true },
    (socket, req) => {
      const { moduleInstanceId, taskRunId } = req.query;
      let lastTimestamp = new Date().toISOString();
      let alive = true;

      const poll = async () => {
        if (!alive) return;

        try {
          const db = getDatabase();
          const conditions = [gt(logs.timestamp, new Date(lastTimestamp))];

          if (moduleInstanceId) {
            conditions.push(eq(logs.moduleInstanceId, moduleInstanceId));
          }

          if (taskRunId) {
            conditions.push(eq(logs.taskRunId, taskRunId));
          }

          const newLogs = await db.select().from(logs)
            .where(and(...conditions))
            .orderBy(desc(logs.timestamp))
            .limit(100);

          if (newLogs.length > 0) {
            lastTimestamp = newLogs[0]!.timestamp.toISOString();
            socket.send(JSON.stringify(newLogs.reverse()));
          }
        } catch {
          // DB error during poll — ignore, will retry
        }

        if (alive) {
          setTimeout(() => {
            void poll();
          }, POLL_INTERVAL_MS);
        }
      };

      void poll();

      socket.on('close', () => {
        alive = false;
      });
      socket.on('error', () => {
        alive = false;
      });
    }
  );
}
