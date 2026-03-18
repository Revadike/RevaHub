import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import * as schema from './schema.js';

let db: ReturnType<typeof drizzle<typeof schema>> | null = null;
let pglite: PGlite | null = null;

/**
 * Initializes the database connection pool and returns the Drizzle ORM instance.
 */
export async function initDatabase(dataDir: string) {
  pglite = new PGlite(dataDir);
  db = drizzle({ client: pglite, schema });
  return db;
}

/**
 *  If the database has not been initialized yet.
 * @returns
 */
export function getDatabase() {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }

  return db;
}

/**
 * @returns
 */
export function getPGlite() {
  return pglite;
}

/*
 * @returns
 **
 */
export async function closeDatabase() {
  if (pglite) {
    await pglite.close();
    pglite = null;
    db = null;
  }
}

export type Database = NonNullable<typeof db>;
