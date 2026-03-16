import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { getDatabase } from './index.js';

/**
 * Runs all pending Drizzle migrations against the database.
 * @param migrationsFolder - Path to the folder containing migration files
 */
export async function runMigrations(migrationsFolder: string) {
  const db = getDatabase();
  await migrate(db, { migrationsFolder });
}
