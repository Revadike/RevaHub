import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pglite: PGlite | null = null;

/**
 * Initializes the database connection pool and returns the Drizzle ORM instance.
 *
 * @param dataDir - Directory path for PGlite data storage
 */
export async function initDatabase(dataDir: string) {
  pglite = new PGlite(dataDir);
  db = drizzle({ client: pglite, schema });
  return db;
}

/**
 * Returns the active Drizzle ORM database instance.
 *
 * @throws Error if the database has not been initialized yet
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }

  return db;
}

/**
 * Returns the underlying PGlite instance for raw queries or shutdown.
 */
export function getPGlite() {
  return pglite;
}

/**
 * Closes the PGlite database connection.
 */
export async function closeDatabase() {
  if (pglite) {
    await pglite.close();
    pglite = null;
    db = null;
  }
}

export type Database = NonNullable<typeof db>;
