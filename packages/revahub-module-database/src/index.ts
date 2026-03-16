import pg from 'pg';

export type DatabaseInstance = InstanceType<typeof Database>;

interface ModuleContext {
  emit: (eventName: string, data: unknown) => void;
  onDestroy: (fn: () => Promise<void> | void) => void;
  options: Record<string, unknown>;
  instances: Record<string, unknown>;
}

class Database {
  private pool: pg.Pool;

  constructor(private ctx: ModuleContext) {
    const connectionString = process.env.DATABASE_URL ?? 'postgresql://revahub:revahub@localhost:5432/revahub';
    this.pool = new pg.Pool({ connectionString });

    ctx.onDestroy(async () => {
      await this.pool.end();
    });
  }

  /**
   * Executes a parameterized SQL query against the database.
   * @param text - SQL query with $1, $2, ... placeholders
   * @param params - Parameter values
   * @returns Query result rows
   */
  async query(text: string, params?: unknown[]) {
    const result = await this.pool.query(text, params);
    return result.rows;
  }

  /**
   * Executes a query and returns the first row, or null.
   * @param text - SQL query
   * @param params - Parameter values
   */
  async queryOne(text: string, params?: unknown[]) {
    const rows = await this.query(text, params);
    return rows[0] ?? null;
  }
}

/**
 * Factory function for the database module.
 * @param ctx - Module context provided by the RevaHub core
 * @returns A Database instance
 */
export default (ctx: ModuleContext) => {
  return new Database(ctx);
};
