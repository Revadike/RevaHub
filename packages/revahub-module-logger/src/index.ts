export type LoggerInstance = InstanceType<typeof Logger>;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface ModuleContext {
  emit: (eventName: string, data: unknown) => void;
  onDestroy: (fn: () => Promise<void> | void) => void;
  options: Record<string, unknown>;
  instances: {
    database: { query: (text: string, params?: unknown[]) => Promise<unknown[]> };
    [key: string]: unknown;
  };
}

class Logger {
  constructor(private ctx: ModuleContext) {}

  /**
   * Writes a log entry to the database.
   * @param level - Log severity level
   * @param message - Log message
   * @param data - Optional structured context data
   * @param meta - Optional task run or instance ID for association
   */
  private async log(
    level: LogLevel,
    message: string,
    data?: unknown,
    meta?: { taskRunId?: string; moduleInstanceId?: string }
  ) {
    const id = `log_${Date.now()}_${Math.random().toString(36)
      .slice(2, 7)}`;

    this.ctx.emit('log', { level, message, data });

    try {
      await this.ctx.instances.database.query(
        `INSERT INTO logs (id, level, message, data, task_run_id, module_instance_id, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          id,
          level,
          message,
          data ? JSON.stringify(data) : null,
          meta?.taskRunId ?? null,
          meta?.moduleInstanceId ?? null
        ]
      );
    } catch {
      // Fallback to console if DB write fails
      console.error(`[Logger] Failed to write log to database: ${message}`);
    }
  }

  /**
   * Logs a debug-level message.
   * @param message - Log message
   * @param data - Optional structured data
   * @param meta - Optional association metadata
   */
  async debug(message: string, data?: unknown, meta?: { taskRunId?: string; moduleInstanceId?: string }) {
    await this.log('debug', message, data, meta);
  }

  /**
   * Logs an info-level message.
   * @param message - Log message
   * @param data - Optional structured data
   * @param meta - Optional association metadata
   */
  async info(message: string, data?: unknown, meta?: { taskRunId?: string; moduleInstanceId?: string }) {
    await this.log('info', message, data, meta);
  }

  /**
   * Logs a warn-level message.
   * @param message - Log message
   * @param data - Optional structured data
   * @param meta - Optional association metadata
   */
  async warn(message: string, data?: unknown, meta?: { taskRunId?: string; moduleInstanceId?: string }) {
    await this.log('warn', message, data, meta);
  }

  /**
   * Logs an error-level message.
   * @param message - Log message
   * @param data - Optional structured data
   * @param meta - Optional association metadata
   */
  async error(message: string, data?: unknown, meta?: { taskRunId?: string; moduleInstanceId?: string }) {
    await this.log('error', message, data, meta);
  }
}

/**
 * Factory function for the logger module.
 * @param ctx - Module context provided by the RevaHub core
 * @returns A Logger instance
 */
export default (ctx: ModuleContext) => {
  return new Logger(ctx);
};
