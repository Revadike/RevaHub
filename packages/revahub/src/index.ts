import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { initDatabase, getDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { modules, moduleInstances, tasks, settings } from './db/schema.js';
import { CoreEventBus } from './core/event-bus.js';
import { ModuleManager } from './core/module-manager.js';
import { TaskRunner } from './core/task-runner.js';
import { resolvePackagePath, scanPackage } from './core/package-scanner.js';
import { createServer } from './api/server.js';
import { eq } from 'drizzle-orm';

const execAsync = promisify(exec);

const NATIVE_MODULES = ['revahub-module-database', 'revahub-module-logger'];
const NATIVE_TASKS = ['revahub-task-cleanup-logs'];
const DEFAULT_PORT = 3000;
const DEFAULT_DB_URL = 'postgresql://revahub:revahub@localhost:5432/revahub';

/**
 * Resolves the working directory for RevaHub data and packages.
 * @param envOverride - Optional override from environment variable
 */
function getWorkingDir(envOverride?: string): string {
  return envOverride ?? join(homedir(), '.revahub');
}

/**
 * Ensures the working directory exists and has a package.json.
 * @param dir - Path to the working directory
 */
async function ensureWorkingDir(dir: string) {
  await mkdir(dir, { recursive: true });

  const pkgPath = join(dir, 'package.json');
  try {
    await access(pkgPath);
  } catch {
    await writeFile(pkgPath, JSON.stringify({
      name: 'revahub-workspace',
      private: true,
      type: 'module'
    }, null, 2));
  }
}

/**
 * Registers a native module in the database and creates its default instance.
 * @param moduleName - npm package name of the native module
 * @param workingDir - Workspace root
 */
async function registerNativeModule(moduleName: string, workingDir: string) {
  const packageDir = await resolvePackagePath(moduleName, workingDir);
  const scanned = await scanPackage(packageDir);

  if (!scanned || scanned.revahub.type !== 'module') {
    console.error(`[Init] Failed to scan native module: ${moduleName}`);
    return;
  }

  const db = getDatabase();
  const meta = scanned.revahub;

  await db.insert(modules).values({
    name: scanned.name,
    version: scanned.version,
    label: meta.label,
    native: true
  })
    .onConflictDoUpdate({
      target: modules.name,
      set: { version: scanned.version, label: meta.label }
    });

  // Create default instance if none exists
  const shortName = moduleName.replace('revahub-module-', '');
  const defaultId = `__native_${shortName}__`;
  const existing = await db.select().from(moduleInstances)
    .where(eq(moduleInstances.id, defaultId));

  if (existing.length === 0) {
    await db.insert(moduleInstances).values({
      id: defaultId,
      moduleName: scanned.name,
      label: shortName,
      options: {},
      enabled: true,
      autoRestart: true
    });
  }
}

/**
 * Registers a native task in the database.
 * @param taskName - npm package name of the native task
 * @param workingDir - Workspace root
 */
async function registerNativeTask(taskName: string, workingDir: string) {
  const packageDir = await resolvePackagePath(taskName, workingDir);
  const scanned = await scanPackage(packageDir);

  if (!scanned || scanned.revahub.type !== 'task') {
    console.error(`[Init] Failed to scan native task: ${taskName}`);
    return;
  }

  const db = getDatabase();
  const meta = scanned.revahub;

  await db.insert(tasks).values({
    name: scanned.name,
    version: scanned.version,
    label: meta.label,
    native: true
  })
    .onConflictDoUpdate({
      target: tasks.name,
      set: { version: scanned.version, label: meta.label }
    });
}

/**
 * Initializes default settings in the database.
 * @param port - Default server port
 */
async function ensureDefaultSettings(port: number) {
  const db = getDatabase();
  await db.insert(settings).values({ key: 'port', value: port })
    .onConflictDoNothing();
}

/**
 * Boots the RevaHub platform: initializes the database, registers native
 * packages, starts all module instances, sets up task triggers, and
 * launches the HTTP server.
 */
export async function start() {
  const workingDir = getWorkingDir(process.env.REVAHUB_DIR);
  const dbUrl = process.env.DATABASE_URL ?? DEFAULT_DB_URL;
  const port = parseInt(process.env.PORT ?? String(DEFAULT_PORT), 10);

  console.info('[RevaHub] Starting...');
  console.info(`[RevaHub] Working directory: ${workingDir}`);

  // 1. Ensure working directory
  await ensureWorkingDir(workingDir);
  console.info('[RevaHub] Working directory ready');

  // 2. Initialize database
  initDatabase(dbUrl);
  console.info('[RevaHub] Database pool initialized');

  // 3. Run migrations
  const migrationsDir = join(import.meta.dirname ?? '.', 'db', 'migrations');
  try {
    await runMigrations(migrationsDir);
    console.info('[RevaHub] Migrations complete');
  } catch (err) {
    console.error('[RevaHub] Migration warning:', err instanceof Error ? err.message : err);
  }

  // 4. Install and register native packages
  for (const mod of NATIVE_MODULES) {
    console.info(`[RevaHub] Registering native module: ${mod}`);
    try {
      await execAsync(`npm install ${mod}`, { cwd: workingDir });
    } catch {
      // May already be installed via workspace
    }

    await registerNativeModule(mod, workingDir);
  }

  for (const task of NATIVE_TASKS) {
    try {
      await execAsync(`npm install ${task}`, { cwd: workingDir });
    } catch {
      // May already be installed via workspace
    }

    await registerNativeTask(task, workingDir);
  }

  // 5. Ensure default settings
  await ensureDefaultSettings(port);

  // 6. Create core services
  const eventBus = new CoreEventBus();
  const moduleManager = new ModuleManager(eventBus, workingDir);
  const taskRunner = new TaskRunner(eventBus, moduleManager, workingDir);

  // 7. Start all enabled instances
  try {
    await moduleManager.startAll();
  } catch (err) {
    console.error('[RevaHub] Some instances failed to start:', err);
  }

  // 8. Initialize task triggers
  await taskRunner.initialize();

  // 9. Create and start HTTP server
  const server = await createServer({ moduleManager, taskRunner, workingDir });

  // Graceful shutdown
  const shutdown = async () => {
    console.info('[RevaHub] Shutting down...');
    await taskRunner.shutdown();
    await moduleManager.shutdownAll();
    await server.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await server.listen({ port, host: '0.0.0.0' });
  console.info(`[RevaHub] Server running on http://localhost:${port}`);
}

export * from './types.js';
export * from './db/schema.js';
