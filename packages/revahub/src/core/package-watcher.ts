import { watch, type FSWatcher } from 'chokidar';
import { dirname, basename, join } from 'node:path';
import { scanPackage, deregisterPackage, registerPackage } from './package-scanner.js';

export interface PackageWatcherOptions {
  workingDir: string;
  localPackagesDir: string | null;
  nativePackages: Set<string>;
  onPackageAdded?: (name: string) => void | Promise<void>;
  onPackageChanged?: (name: string) => void | Promise<void>;
  onPackageRemoved?: (name: string) => void | Promise<void>;
}

/**
 * Watches for package changes in the working directory and local packages dir.
 */
export class PackageWatcher {
  private watcher: FSWatcher | null = null;
  private options: PackageWatcherOptions;
  private watchedDirs: string[] = [];

  constructor(options: PackageWatcherOptions) {
    this.options = options;

    // Build list of directories to watch
    this.watchedDirs.push(join(options.workingDir, 'packages'));
    if (options.localPackagesDir) {
      this.watchedDirs.push(options.localPackagesDir);
    }
  }

  /**
   * Starts watching for package changes.
   */
  start() {
    if (this.watcher) return;

    // Watch directories directly (Chokidar v5 no longer supports glob patterns)
    this.watcher = watch(this.watchedDirs, {
      persistent: true,
      ignoreInitial: true,
      depth: 1,
      ignored: (path, stats) => {
        // Allow directories to be traversed
        if (stats?.isDirectory()) return false;

        // Only watch package.json files
        return basename(path) !== 'package.json';
      },
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher.on('add', (path: string) => this.handleAdd(path));
    this.watcher.on('change', (path: string) => this.handleChange(path));
    this.watcher.on('unlink', (path: string) => this.handleUnlink(path));
    this.watcher.on('error', (err: unknown) => {
      console.error('Error:', err);
    });

    console.info(`Watching: ${this.watchedDirs.join(', ')}`);
  }

  /**
   * Stops watching for package changes.
   */
  stop() {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  /**
   * Handles a new package.json being added.
   */
  private async handleAdd(filePath: string) {
    const packageDir = dirname(filePath);
    const scanned = await scanPackage(packageDir);

    if (scanned) {
      await registerPackage(packageDir, 'local', this.options.nativePackages);

      if (this.options.onPackageAdded) {
        await this.options.onPackageAdded(scanned.name);
      }
    }
  }

  /**
   * Handles a package.json being changed.
   */
  private async handleChange(filePath: string) {
    const packageDir = dirname(filePath);
    const scanned = await scanPackage(packageDir);

    if (scanned) {
      // Re-register to update metadata
      await registerPackage(packageDir, 'local', this.options.nativePackages);

      if (this.options.onPackageChanged) {
        await this.options.onPackageChanged(scanned.name);
      }
    }
  }

  /**
   * Handles a package.json being deleted.
   */
  private async handleUnlink(filePath: string) {
    const packageDir = dirname(filePath);
    const packageName = basename(packageDir);

    // Try to determine package name from the directory name
    // This is a best-effort approach since the package.json is gone
    const possibleNames = [
      packageName,
      `revahub-module-${packageName}`,
      `revahub-task-${packageName}`
    ];

    for (const name of possibleNames) {
      if (deregisterPackage(name)) {
        if (this.options.onPackageRemoved) {
          await this.options.onPackageRemoved(name);
        }

        return;
      }
    }
  }
}
