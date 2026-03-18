import { boolean, index, jsonb, integer, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

// ── Module Instances ──

export const moduleInstances = pgTable('module_instances', {
  id: text('id').primaryKey(),
  moduleName: text('module_name').notNull(),
  label: text('label').notNull(),
  options: jsonb('options').notNull()
    .default({}),
  enabled: boolean('enabled').notNull()
    .default(true),
  autoRestart: boolean('auto_restart').notNull()
    .default(false),
  status: text('status').notNull()
    .default('stopped'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
    .defaultNow()
});

// ── Tasks (formerly task_configs) ──

export const tasks = pgTable('tasks', {
  id: text('id').primaryKey(),
  taskName: text('task_name').notNull(),
  label: text('label').notNull(),
  options: jsonb('options').notNull()
    .default({}),
  enabled: boolean('enabled').notNull()
    .default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull()
    .defaultNow()
});

// ── Task Runs ──

export const taskRuns = pgTable('task_runs', {
  id: text('id').primaryKey(),
  taskId: text('task_id').notNull()
    .references(() => tasks.id),
  triggerType: text('trigger_type').notNull(),
  triggerPayload: jsonb('trigger_payload'),
  status: text('status').notNull()
    .default('running'),
  result: jsonb('result'),
  error: text('error'),
  retryCount: integer('retry_count').notNull()
    .default(0),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull()
    .defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true })
});

// ── Logs ──

export const logs = pgTable('logs', {
  id: text('id').primaryKey(),
  level: text('level').notNull(),
  message: text('message').notNull(),
  data: jsonb('data'),
  taskRunId: text('task_run_id').references(() => taskRuns.id),
  moduleInstanceId: text('module_instance_id').references(() => moduleInstances.id),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull()
    .defaultNow()
}, (table) => [
  index('logs_task_run_id_idx').on(table.taskRunId),
  index('logs_module_instance_id_idx').on(table.moduleInstanceId),
  index('logs_timestamp_desc_idx').on(table.timestamp)
]);

// ── Settings ──

export const settings = pgTable('settings', {
  key: text('key').primaryKey(),
  value: jsonb('value')
});
