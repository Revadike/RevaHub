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
   */
  start() {
    if (this.watcher) return;

    // Watch for package.json files in watched directories
    const patterns = this.watchedDirs.map(dir => join(dir, '*', 'package.json'));

    this.watcher = watch(patterns, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 500,
        pollInterval: 100
      }
    });

    this.watcher.on('add', (path: string) => this.handleAdd(path));
    this.watcher.on('change', (path: string) => this.handleChange(path));
    this.watcher.on('unlink', (path: string) => this.handleUnlink(path));
    this.watcher.on('error', (err: unknown) => {
      console.error('[PackageWatcher] Error:', err);
    });

    console.info(`[PackageWatcher] Watching: ${this.watchedDirs.join(', ')}`);
  }

  /**
   */
  stop() {
    if (this.watcher) {
      void this.watcher.close();
      this.watcher = null;
    }
  }

  /**
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
