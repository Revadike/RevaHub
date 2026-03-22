import { getDatabase } from './index.js';
import * as schema from './schema.js';

/**
 * Default seed data keyed by table name.
 */
const defaults = {
  settings: [
    { key: 'port', value: 3000 },
    { key: 'localPackagesDir', value: null }
  ],
  tasks: [
    {
      id: 'task_cleanup_logs',
      taskName: 'revahub-task-cleanup-logs',
      label: 'Cleanup Logs',
      options: { retentionDays: 30 },
      enabled: false
    }
  ]
} as const;

/**
 * Seeds the database with defaults.
 * Uses onConflictDoNothing to avoid overwriting existing values.
 */
export async function seedDefaults() {
  const db = getDatabase();

  for (const [name, values] of Object.entries(defaults)) {
    const table = schema[name as keyof typeof schema];

    await db
      .insert(table)
      .values(values as never)
      .onConflictDoNothing();
  }
}
