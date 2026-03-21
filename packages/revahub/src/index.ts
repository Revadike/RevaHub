import { mkdir, writeFile, access } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { eq, like } from 'drizzle-orm';

import { createServer } from './api/server.js';
import { CoreEventBus } from './core/event-bus.js';
import { ModuleManager } from './core/module-manager.js';
import { PackageScanner } from './core/package-scanner.js';
import { PackageWatcher } from './core/package-watcher.js';
import { TaskRunner } from './core/task-runner.js';
import { initDatabase, getDatabase, closeDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { moduleInstances, tasks, settings } from './db/schema.js';
import { isDev } from './utils/environment.js';

/**
 * Resolves the working directory for RevaHub data and packages.
 *
 * @returns Path to working directory
 */
export function getWorkingDir(): string {
  // TODO: Make user-configurable via UI
  return join(homedir(), '.revahub');
}

/**
 * Ensures the working directory exists and has a package.json.
 *
 * @param dir - Path to the working directory
 */
async function ensureWorkingDir(dir: string) {
  await mkdir(dir, { recursive: true });
  await mkdir(join(dir, 'db'), { recursive: true });
  await mkdir(join(dir, 'packages'), { recursive: true });

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
 * Retrieves a setting value from the database.
 *
 * @typeParam T - Expected type of the setting value
 * @param key - Setting key
 * @returns Setting value or undefined if not found
 */
async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = getDatabase();
  const [row] = await db
    .select()
    .from(settings)
    .where(eq(settings.key, key));

  return row?.value as T | undefined;
}

/**
 * Ensures default settings exist in the database.
 */
async function ensureDefaultSettings() {
  const db = getDatabase();

  await db
    .insert(settings)
    .values({ key: 'port', value: 3000 })
    .onConflictDoNothing();

  await db
    .insert(settings)
    .values({ key: 'localPackagesDir', value: null })
    .onConflictDoNothing();
}

/**
 * Cleans up legacy native instance IDs and ensures default instances exist for all native modules.
 *
 * @param scanner - PackageScanner instance
 */
async function ensureNativeModuleInstances(scanner: PackageScanner) {
  const db = getDatabase();
  const registry = scanner.getRegistry();
  const nativeModules = scanner.getNativeModules();

  // Delete old __native_*__ entries (legacy format)
  const oldEntries = await db
    .select()
    .from(moduleInstances)
    .where(like(moduleInstances.id, '__native_%'));

  for (const entry of oldEntries) {
    await db.delete(moduleInstances).where(eq(moduleInstances.id, entry.id));
    console.info(`Removed legacy instance: ${entry.id}`);
  }

  for (const moduleName of nativeModules) {
    const pkg = registry.get(moduleName);
    if (!pkg || pkg.type !== 'module') continue;

    const shortName = moduleName.replace('revahub-module-', '').replaceAll(/-/g, '_');
    const defaultId = `inst_${shortName}`;

    const [existing] = await db
      .select()
      .from(moduleInstances)
      .where(eq(moduleInstances.id, defaultId));

    if (!existing) {
      await db.insert(moduleInstances).values({
        id: defaultId,
        moduleName,
        label: shortName,
        options: {},
        enabled: true,
        autoRestart: true
      });
      console.info(`Created native module instance: ${defaultId}`);
    }
  }
}

/**
 * Ensures default task configs exist for all native tasks.
 *
 * @param scanner - PackageScanner instance
 */
async function ensureNativeTaskConfigs(scanner: PackageScanner) {
  const db = getDatabase();
  const registry = scanner.getRegistry();
  const nativeTasks = scanner.getNativeTasks();

  for (const taskName of nativeTasks) {
    const pkg = registry.get(taskName);
    if (!pkg || pkg.type !== 'task') continue;

    const shortName = taskName.replace('revahub-task-', '').replaceAll(/-/g, '_');
    const defaultId = `task_${shortName}`;

    const [existing] = await db
      .select()
      .from(tasks)
      .where(eq(tasks.id, defaultId));

    if (!existing) {
      await db.insert(tasks).values({
        id: defaultId,
        taskName,
        label: pkg.label,
        options: {},
        enabled: true
      });
      console.info(`Created native task config: ${defaultId}`);
    }
  }
}

/**
 * Updates module instance and task statuses based on package availability.
 * Marks instances as 'missing' if their package is not found,
 * and recovers them to 'stopped' if packages are found again.
 *
 * @param scanner - Package scanner used to resolve current registry availability
 */
async function flagMissingPackages(scanner: PackageScanner) {
  const db = getDatabase();
  const registry = scanner.getRegistry();

  const allInstances = await db.select().from(moduleInstances);
  for (const instance of allInstances) {
    const packageExists = registry.has(instance.moduleName);

    if (!packageExists && instance.status !== 'missing') {
      await db
        .update(moduleInstances)
        .set({ status: 'missing' })
        .where(eq(moduleInstances.id, instance.id));
    } else if (packageExists && instance.status === 'missing') {
      // Recover from missing status when package is found again
      await db
        .update(moduleInstances)
        .set({ status: 'stopped' })
        .where(eq(moduleInstances.id, instance.id));
    }
  }

  const allTasks = await db.select().from(tasks);
  for (const task of allTasks) {
    if (!registry.has(task.taskName)) {
      console.warn(`Configuration "${task.id}" exists for missing task "${task.taskName}"`);
    }
  }
}

/**
 * Starts the RevaHub server and all its subsystems.
 */
export async function start() {
  const workingDir = getWorkingDir();

  console.info('Starting...');
  console.info(`Working directory: ${workingDir}`);

  await ensureWorkingDir(workingDir);
  console.info('Working directory ready');

  const dbDir = join(workingDir, 'db');
  await initDatabase(dbDir);
  console.info('PGlite database initialized');

  const migrationsDir = join(import.meta.dirname ?? '.', 'db', 'migrations');
  try {
    await runMigrations(migrationsDir);
    console.info('Migrations complete');
  } catch (err) {
    console.error('Migration warning:', err instanceof Error ? err.message : err);
  }

  // TODO: Seed this data instead
  await ensureDefaultSettings();

  // Use port 3001 in dev mode (ignore database setting), port 3000 in production
  const port = isDev ? 3001 : (await getSetting<number>('port') ?? 3000);
  const localPackagesDir = await getSetting<string>('localPackagesDir') ?? null;

  if (isDev) {
    console.info(`Running in dev mode on port ${port} (Vite should be on port 3000)`);
  }

  const scanner = await PackageScanner.create();
  const nativePackages = scanner.getNativePackages();
  console.info(`Detected ${nativePackages.size} native packages`);

  console.info('Scanning packages...');
  await scanner.scanAll({
    workingDir,
    localPackagesDir
  });
  await scanner.ensureNativePackages(workingDir);

  const registry = scanner.getRegistry();
  console.info(`Found ${registry.size} packages`);

  await ensureNativeModuleInstances(scanner);
  await ensureNativeTaskConfigs(scanner);
  await flagMissingPackages(scanner);

  const eventBus = new CoreEventBus();
  const moduleManager = new ModuleManager(eventBus, scanner, workingDir);
  const taskRunner = new TaskRunner(eventBus, moduleManager, scanner, workingDir);

  try {
    await moduleManager.startAll();
  } catch (err) {
    console.error('Some instances failed to start:', err);
  }

  await taskRunner.initialize();

  const packageWatcher = new PackageWatcher({
    workingDir,
    localPackagesDir,
    scanner,
    onPackageAdded: async (name) => {
      console.info(`Package added: ${name}`);
      await scanner.scanAll({ workingDir, localPackagesDir });
      await scanner.ensureNativePackages(workingDir);
    },
    onPackageChanged: async (name) => {
      console.info(`Package changed: ${name}`);
      await scanner.scanAll({ workingDir, localPackagesDir });
      await scanner.ensureNativePackages(workingDir);
    },
    onPackageRemoved: async (name) => {
      console.info(`Package removed: ${name}`);
      await flagMissingPackages(scanner);
    }
  });

  packageWatcher.start();

  const server = await createServer({
    moduleManager,
    taskRunner,
    workingDir,
    scanner,
    packageWatcher
  });

  let isShuttingDown = false;

  const shutdown = async () => {
    if (isShuttingDown) {
      return;
    }

    console.info('Shutting down...');
    isShuttingDown = true;

    const shutdownTimeout = setTimeout(() => {
      console.warn('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, 3000);

    try {
      packageWatcher.stop();
      await taskRunner.shutdown();
      await moduleManager.shutdownAll();
      await server.close();
      await closeDatabase();
    } catch (err) {
      console.error('Error during shutdown:', err);
    } finally {
      if (shutdownTimeout) clearTimeout(shutdownTimeout);

      process.exit(0);
    }
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('SIGBREAK', shutdown);
  process.on('SIGUSR2', shutdown);

  await server.listen({ port, host: '0.0.0.0' });
  console.info(`Server running on http://localhost:${port}`);
}
