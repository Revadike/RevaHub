import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { getPGlite } from './index.js';

/**
 * @param sql - SQL text to split
 */
function splitSQL(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let inDoBlock = false;

  const lines = sql.split('\n');
  for (const line of lines) {
    current += `${line}\n`;

    if (line.trim().startsWith('DO $$')) {
      inDoBlock = true;
    }

    if (inDoBlock && line.trim() === 'END $$;') {
      inDoBlock = false;
      statements.push(current.trim());
      current = '';
    } else if (!inDoBlock && line.trim().endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements.filter(s => s && !s.startsWith('--'));
}

/**
 * Runs all pending Drizzle migrations against the database.
 * @param migrationsFolder - Path to the folder containing migration SQL files
 */
export async function runMigrations(migrationsFolder: string) {
  const pglite = getPGlite();
  if (!pglite) {
    throw new Error('PGlite database not initialized');
  }

  // Read migration files (*.sql) in order
  const files = readdirSync(migrationsFolder)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const filePath = join(migrationsFolder, file);
    const sql = readFileSync(filePath, 'utf-8');
    const statements = splitSQL(sql);

    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await pglite.exec(stmt);
        } catch (err) {
          // Ignore already-exists errors
          if (err instanceof Error && !err.message.includes('already exists')) {
            throw err;
          }
        }
      }
    }
  }
}
