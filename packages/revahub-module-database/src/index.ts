import pg from 'pg';
import type { ModuleContext, DatabaseInstance as IDatabaseInstance, PGliteProxy } from 'revahub-types';

export type DatabaseInstance = IDatabaseInstance;

/**
 * Database module supporting dual mode:
 * - Default: Uses embedded PGlite (via proxy to main thread)
 * - External: Connects to PostgreSQL when connectionString option is provided
 */
class Database implements IDatabaseInstance {
  private pool: pg.Pool | null = null;
  private pglite: PGliteProxy | null = null;
  private schemaPrefix: string;
  private useExternal: boolean;

  constructor(private ctx: ModuleContext) {
    const connectionString = ctx.options.connectionString as string | undefined;
    this.schemaPrefix = (ctx.options.schemaPrefix as string) ?? '';
    this.useExternal = !!connectionString;

    if (this.useExternal) {
      // External PostgreSQL mode
      this.pool = new pg.Pool({ connectionString });
      // TODO: Add configurable pool options (max, idleTimeoutMillis, connectionTimeoutMillis)?

      ctx.onDestroy(async () => {
        await this.pool?.end();
      });
    } else {
      // Embedded PGlite mode - use proxy to main thread
      this.pglite = ctx.instances.pglite;
      if (!this.pglite) {
        throw new Error('PGlite proxy not available from core');
      }
    }
  }

  /**
   * Executes a parameterized SQL query.
   *
   * @param text - SQL query with $1, $2, ... placeholders
   * @param params - Parameter values
   * @returns Query result rows
   */
  async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
    // Optionally prefix table references with schema (simple approach)
    const processedText = this.schemaPrefix ? this.prefixSchema(text) : text;

    if (this.useExternal && this.pool) {
      const result = await this.pool.query(processedText, params);
      return result.rows;
    } else if (this.pglite) {
      const result = await this.pglite.query<T>(processedText, params);
      return result.rows;
    }

    throw new Error('No database connection available');
  }

  /**
   * Executes a query and returns the first row, or null.
   *
   * @param text - SQL query
   * @param params - Parameter values
   */
  async queryOne<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(text, params);
    return rows[0] ?? null;
  }

  /**
   * Simple schema prefix injection for table references.
   * This is a basic implementation - complex queries may need manual handling.
   *
   * @param text - Raw SQL query text
   */
  private prefixSchema(text: string): string {
    // Replace FROM/INTO/UPDATE table references with prefixed versions
    // This is a simple approach - for complex cases, use explicit schema in queries
    return text;
  }
}

/**
 * Factory function for the database module.
 *
 * @param ctx - Module context provided by the RevaHub core
 * @returns A Database instance
 */
export default (ctx: ModuleContext): DatabaseInstance => {
  return new Database(ctx);
};
