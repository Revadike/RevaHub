interface TaskContext {
  options: Record<string, unknown>;
  event?: unknown;
  background: (fn: () => Promise<void>) => void;
  instances: {
    logger: {
      info: (message: string, data?: unknown) => Promise<void>;
      error: (message: string, data?: unknown) => Promise<void>;
    };
    database: {
      query: (text: string, params?: unknown[]) => Promise<unknown[]>;
    };
    [key: string]: unknown;
  };
}

/**
 * Deletes log entries older than the configured retention period.
 * Uses the auto-injected `database` instance to execute the cleanup query.
 * @param ctx - Task context with options and native instances
 * @returns Summary of deleted log count
 */
export default async (ctx: TaskContext) => {
  const retentionDays = ctx.options.retentionDays as number;

  if (!retentionDays || retentionDays <= 0) {
    throw new Error('retentionDays must be a positive number');
  }

  const result = await ctx.instances.database.query(
    'DELETE FROM logs WHERE timestamp < NOW() - INTERVAL \'1 day\' * $1 RETURNING id',
    [retentionDays]
  ) as Array<{ id: string }>;

  const deletedCount = result.length;
  await ctx.instances.logger.info(`Cleaned up ${deletedCount} log entries older than ${retentionDays} days`);

  return { deletedCount, retentionDays };
};
