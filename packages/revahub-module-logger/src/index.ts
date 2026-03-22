import type { ModuleContext } from 'revahub-types';

export type LoggerInstance = InstanceType<typeof Logger>;

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

class Logger {
  constructor(private ctx: ModuleContext) {}

  /**
   * Writes a log entry to the database.
   *
   * @param level - Log severity level
   * @param message - Log message
   * @param data - Optional structured context data
   */
  private async log(
    level: LogLevel,
    message: string,
    data?: unknown
  ) {
    const id = `log_${Date.now()}_${Math
      .random()
      .toString(36)
      .slice(2, 7)}`;

    this.ctx.emit('log', { level, message, data });

    const { taskRunId = null, moduleInstanceId = null } = this.ctx.getCallerContext() || {};

    try {
      await this.ctx.instances.database.query(
        `INSERT INTO logs (id, level, message, data, task_run_id, module_instance_id, timestamp)
         VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
        [
          id,
          level,
          message,
          data ? JSON.stringify(data) : null,
          taskRunId,
          moduleInstanceId
        ]
      );
    } catch {
      // Fallback to console if DB write fails
      console.error(`Failed to write log to database: ${message}`);
    }
  }

  /**
   * Logs a debug-level message.
   *
   * @param message - Log message
   * @param data - Optional structured data
   */
  async debug(message: string, data?: unknown) {
    await this.log('debug', message, data);
  }

  /**
   * Logs an info-level message.
   *
   * @param message - Log message
   * @param data - Optional structured data
   */
  async info(message: string, data?: unknown) {
    await this.log('info', message, data);
  }

  /**
   * Logs a warn-level message.
   *
   * @param message - Log message
   * @param data - Optional structured data
   */
  async warn(message: string, data?: unknown) {
    await this.log('warn', message, data);
  }

  /**
   * Logs an error-level message.
   *
   * @param message - Log message
   * @param data - Optional structured data
   */
  async error(message: string, data?: unknown) {
    await this.log('error', message, data);
  }
}

/**
 * Factory function for the logger module.
 *
 * @param ctx - Module context provided by the RevaHub core
 * @returns A Logger instance
 */
export default (ctx: ModuleContext) => {
  return new Logger(ctx);
};
