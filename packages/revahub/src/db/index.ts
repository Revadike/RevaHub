import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pool: pg.Pool | null = null;

/**
 * Initializes the database connection pool and returns the Drizzle ORM instance.
 * @param connectionString - PostgreSQL connection URL
 */
export function initDatabase(connectionString: string) {
  pool = new pg.Pool({ connectionString });
  db = drizzle({ client: pool, schema });
  return db;
}

/**
 * Returns the active Drizzle ORM database instance.
 * @throws If the database has not been initialized yet.
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }

  return db;
}

/**
 * Returns the underlying pg.Pool for raw queries or shutdown.
 */
export function getPool() {
  return pool;
}

export type Database = NonNullable<typeof db>;
