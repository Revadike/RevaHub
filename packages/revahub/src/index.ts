import { join } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, access } from 'node:fs/promises';
import { initDatabase, getDatabase, closeDatabase } from './db/index.js';
import { runMigrations } from './db/migrate.js';
import { moduleInstances, tasks, settings } from './db/schema.js';
import { CoreEventBus } from './core/event-bus.js';
import { ModuleManager } from './core/module-manager.js';
import { TaskRunner } from './core/task-runner.js';
import { PackageWatcher } from './core/package-watcher.js';
import {
  scanAllPackages,
  getPackageRegistry,
  registerPackage,
  resolvePackagePath
} from './core/package-scanner.js';
import { createServer } from './api/server.js';
import { eq } from 'drizzle-orm';
import { getNativePackages, getNativeModules } from './utils/native-packages.js';

/**
 * Resolves the working directory for RevaHub data and packages.
 *
 * @param envOverride - Optional override from environment variable
 * @returns Path to working directory
 */
export function getWorkingDir(envOverride?: string): string {
  return envOverride ?? join(homedir(), '.revahub');
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
  const [row] = await db.select().from(settings)
    .where(eq(settings.key, key));
  return row?.value as T | undefined;
}

/**
 * Ensures default settings exist in the database.
 */
async function ensureDefaultSettings() {
  const db = getDatabase();
  await db.insert(settings).values({ key: 'port', value: 3000 })
    .onConflictDoNothing();
  await db.insert(settings).values({ key: 'localPackagesDir', value: null })
    .onConflictDoNothing();
}

/**
 * Ensures default instances exist for all native modules.
 *
 * @param nativeModules - Array of native module package names
 */
async function ensureNativeModuleInstances(nativeModules: string[]) {
  const db = getDatabase();
  const registry = getPackageRegistry();

  for (const moduleName of nativeModules) {
    const pkg = registry.get(moduleName);
    if (!pkg || pkg.type !== 'module') continue;

    const shortName = moduleName.replace('revahub-module-', '');
    const defaultId = `__native_${shortName}__`;

    const [existing] = await db.select().from(moduleInstances)
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
    }
  }
}

/**
 * Marks module instances and tasks as missing if their packages are not found.
 */
async function flagMissingPackages() {
  const db = getDatabase();
  const registry = getPackageRegistry();

  const allInstances = await db.select().from(moduleInstances);
  for (const instance of allInstances) {
    if (!registry.has(instance.moduleName)) {
      await db.update(moduleInstances)
        .set({ status: 'missing' })
        .where(eq(moduleInstances.id, instance.id));
    }
  }

  const allTasks = await db.select().from(tasks);
  for (const task of allTasks) {
    if (!registry.has(task.taskName)) {
      console.warn(`Task package "${task.taskName}" not found for task "${task.id}"`);
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

  await ensureDefaultSettings();

  // Check if we're in dev mode by checking if we're running from src/ or dist/
  // When running with tsx, __dirname will be something like .../packages/revahub/src
  // When running compiled code, __dirname will be .../packages/revahub/dist
  // TODO: Find better solution
  const currentDir = import.meta.dirname ?? '';
  const isDevMode = currentDir.includes('/src') || currentDir.includes('\\src');

  // Use port 3001 in dev mode (ignore database setting), port 3000 in production
  const port = isDevMode ? 3001 : (await getSetting<number>('port') ?? 3000);
  const localPackagesDir = await getSetting<string>('localPackagesDir') ?? null;

  if (isDevMode) {
    console.info(`Running in dev mode on port ${port} (Vite should be on port 3000)`);
  }

  const nativePackages = getNativePackages();
  console.info(`Detected ${nativePackages.size} native packages`);

  for (const pkgName of nativePackages) {
    try {
      const pkgPath = await resolvePackagePath(pkgName, workingDir);
      await registerPackage(pkgPath, 'npm', nativePackages);
      console.info(`Registered native package: ${pkgName}`);
    } catch (err) {
      console.warn(`Failed to register native package ${pkgName}:`, err);
    }
  }

  console.info('Scanning packages...');
  await scanAllPackages({
    workingDir,
    localPackagesDir,
    nativePackages
  });

  const registry = getPackageRegistry();
  console.info(`Found ${registry.size} packages`);

  await ensureNativeModuleInstances(getNativeModules());

  await flagMissingPackages();

  const eventBus = new CoreEventBus();
  const moduleManager = new ModuleManager(eventBus, workingDir);
  const taskRunner = new TaskRunner(eventBus, moduleManager, workingDir);

  try {
    await moduleManager.startAll();
  } catch (err) {
    console.error('Some instances failed to start:', err);
  }

  await taskRunner.initialize();

  const packageWatcher = new PackageWatcher({
    workingDir,
    localPackagesDir,
    nativePackages,
    onPackageAdded: async (name) => {
      console.info(`Package added: ${name}`);
      await scanAllPackages({ workingDir, localPackagesDir, nativePackages });
    },
    onPackageChanged: async (name) => {
      console.info(`Package changed: ${name}`);
      await scanAllPackages({ workingDir, localPackagesDir, nativePackages });
    },
    onPackageRemoved: async (name) => {
      console.info(`Package removed: ${name}`);
      await flagMissingPackages();
    }
  });

  packageWatcher.start();

  const server = await createServer({
    moduleManager,
    taskRunner,
    workingDir,
    nativePackages,
    packageWatcher
  });

  const shutdown = async () => {
    console.info('Shutting down...');
    packageWatcher.stop();
    await taskRunner.shutdown();
    await moduleManager.shutdownAll();
    await server.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());

  await server.listen({ port, host: '0.0.0.0' });
  console.info(`Server running on http://localhost:${port}`);
}

export * from 'revahub-types';
export * from './db/schema.js';
