import { readFile, access, readdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { RevahubMeta, OptionDef, TriggerConfig, PackageSource } from 'revahub-types';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

type ExportsValue = string | { [condition: string]: ExportsValue } | null;

export interface ScannedPackage {
  name: string;
  version: string;
  main: string;
  devMain?: string;
  revahub: RevahubMeta;
}

export interface PackageRegistryEntry {
  name: string;
  version: string;
  label: string;
  description?: string;
  type: 'module' | 'task';
  source: PackageSource;
  path: string;
  main: string;
  devMain?: string;
  native: boolean;
  options?: OptionDef[];
  trigger?: { default?: TriggerConfig };
  timeout?: { default?: number };
}

export interface ScanOptions {
  workingDir: string;
  localPackagesDir: string | null;
}

/**
 * Centralized manager for discovering, registering, and caching revahub packages.
 * Handles both native (bundled) packages and user-installed packages.
 */
export class PackageScanner {
  private readonly packageRegistry = new Map<string, PackageRegistryEntry>();
  private readonly nativePackages: Set<string>;

  private constructor(nativePackages: Set<string>) {
    this.nativePackages = nativePackages;
  }

  /**
   * Resolves the development entry point from a package's exports field.
   * Looks for the "development" condition in the main export (".").
   *
   * @param exports - The exports field from package.json
   * @returns The development entry path or undefined
   */
  private resolveDevelopmentExport(exports: ExportsValue): string | undefined {
    if (!exports || typeof exports === 'string') {
      return undefined;
    }

    // Handle { ".": { "development": "./src/index.ts", "default": "./dist/index.js" } }
    const mainExport = exports['.'];
    if (mainExport && typeof mainExport === 'object') {
      const devEntry = mainExport.development;
      if (typeof devEntry === 'string') {
        return devEntry.startsWith('./') ? devEntry.slice(2) : devEntry;
      }
    }

    // Handle { "development": "./src/index.ts", "default": "./dist/index.js" } (shorthand for ".")
    const devEntry = exports.development;
    if (typeof devEntry === 'string') {
      return devEntry.startsWith('./') ? devEntry.slice(2) : devEntry;
    }

    return undefined;
  }

  /**
   * Creates a new PackageScanner instance asynchronously.
   */
  static async create(): Promise<PackageScanner> {
    const nativePackages = await PackageScanner.loadNativePackages();
    return new PackageScanner(nativePackages);
  }

  /**
   * Loads native package names from the revahub core package.json dependencies.
   */
  private static async loadNativePackages(): Promise<Set<string>> {
    const packageJsonPath = join(__dirname, '..', '..', 'package.json');

    try {
      const raw = await readFile(packageJsonPath, 'utf-8');
      const packageJson = JSON.parse(raw);
      const dependencies = packageJson.dependencies || {};

      const nativePackages = new Set<string>();
      for (const dep of Object.keys(dependencies)) {
        if (dep.startsWith('revahub-module-') || dep.startsWith('revahub-task-')) {
          nativePackages.add(dep);
        }
      }

      return nativePackages;
    } catch (error) {
      console.error('Failed to read revahub package.json for native packages:', error);
      return new Set();
    }
  }

  /**
   * Returns all native package names (read-only).
   */
  getNativePackages(): ReadonlySet<string> {
    return this.nativePackages;
  }

  /**
   * Returns native module package names.
   */
  getNativeModules(): string[] {
    return [...this.nativePackages].filter(p => p.startsWith('revahub-module-'));
  }

  /**
   * Returns native task package names.
   */
  getNativeTasks(): string[] {
    return [...this.nativePackages].filter(p => p.startsWith('revahub-task-'));
  }

  /**
   * Checks if a package is a native package.
   *
   * @param name - Package name to check
   */
  isNativePackage(name: string): boolean {
    return this.nativePackages.has(name);
  }

  /**
   * Returns the full package registry map (read-only).
   */
  getRegistry(): ReadonlyMap<string, PackageRegistryEntry> {
    return this.packageRegistry;
  }

  /**
   * Gets a package entry by name from the registry.
   *
   * @param name - Package name
   */
  getPackage(name: string): PackageRegistryEntry | undefined {
    return this.packageRegistry.get(name);
  }

  /**
   * Clears all entries from the package registry.
   */
  clearRegistry(): void {
    this.packageRegistry.clear();
  }

  /**
   * Reads and parses a revahub package's metadata from its package.json.
   *
   * @param packageDir - Absolute path to the package directory
   * @returns Parsed package metadata or null if invalid
   */
  async scanPackage(packageDir: string): Promise<ScannedPackage | null> {
    try {
      const raw = await readFile(join(packageDir, 'package.json'), 'utf-8');
      const pkg = JSON.parse(raw);

      if (!pkg.revahub || !pkg.name || !pkg.version) {
        return null;
      }

      const keywords: string[] = pkg.keywords ?? [];
      if (!keywords.includes('revahub')) {
        return null;
      }

      // Validate package name follows the revahub-module-* or revahub-task-* pattern
      if (!pkg.name.startsWith('revahub-module-') && !pkg.name.startsWith('revahub-task-')) {
        return null;
      }

      // Validate revahub metadata has a type
      if (!pkg.revahub.type || (pkg.revahub.type !== 'module' && pkg.revahub.type !== 'task')) {
        return null;
      }

      const main = pkg.main ?? 'dist/index.js';

      // Resolve dev entry point from exports field "development" condition
      // Packages must define exports with development condition for hot reload support
      const devMain = this.resolveDevelopmentExport(pkg.exports);

      return {
        name: pkg.name,
        version: pkg.version,
        main,
        devMain,
        revahub: pkg.revahub as RevahubMeta
      };
    } catch {
      return null;
    }
  }

  /**
   * Resolves a package name to its installed directory path.
   * Checks the working directory first, then falls back to the process's
   * own node_modules (supports workspace-linked packages in dev).
   *
   * @param packageName - npm package name
   * @param workingDir - The working directory where packages are installed
   * @returns Path to the package directory
   */
  async resolvePackagePath(packageName: string, workingDir: string): Promise<string> {
    const workingDirPath = join(workingDir, 'node_modules', packageName);
    try {
      await access(join(workingDirPath, 'package.json'));
      return workingDirPath;
    } catch {
      // Not found in working dir
    }

    try {
      const require = createRequire(join(workingDir, 'package.json'));
      const resolved = require.resolve(join(packageName, 'package.json'));
      return dirname(resolved);
    } catch {
      // Not found via working dir require
    }

    try {
      const require = createRequire(join(process.cwd(), 'package.json'));
      const resolved = require.resolve(join(packageName, 'package.json'));
      return dirname(resolved);
    } catch {
      // Not found via process cwd require
    }

    return workingDirPath;
  }

  /**
   * Scans a directory for revahub packages.
   *
   * @param dir - Directory to scan (e.g., node_modules or packages folder)
   * @param source - Package source type
   * @returns Array of found package entries
   */
  private async scanDirectory(
    dir: string,
    source: PackageSource
  ): Promise<PackageRegistryEntry[]> {
    const entries: PackageRegistryEntry[] = [];

    try {
      const items = await readdir(dir);

      for (const item of items) {
        const itemPath = join(dir, item);

        try {
          const stat = await lstat(itemPath);

          // Handle scoped packages (@org/pkg)
          if (stat.isDirectory() && item.startsWith('@')) {
            const scopedItems = await readdir(itemPath);
            for (const scopedItem of scopedItems) {
              const scopedPath = join(itemPath, scopedItem);
              const scopedStat = await lstat(scopedPath);
              if (scopedStat.isDirectory() || scopedStat.isSymbolicLink()) {
                const resolvedPath = scopedStat.isSymbolicLink()
                  ? await realpath(scopedPath)
                  : scopedPath;
                const scanned = await this.scanPackage(resolvedPath);
                if (scanned) {
                  entries.push(this.createRegistryEntry(scanned, resolvedPath, source));
                }
              }
            }
          } else if (stat.isDirectory() || stat.isSymbolicLink()) {
            // Regular package or symlink (for local packages)
            const resolvedPath = stat.isSymbolicLink()
              ? await realpath(itemPath)
              : itemPath;
            const scanned = await this.scanPackage(resolvedPath);
            if (scanned) {
              entries.push(this.createRegistryEntry(scanned, resolvedPath, source));
            }
          }
        } catch (err) {
          console.warn(`Failed to scan package at ${itemPath}:`, err);
        }
      }
    } catch {
      // Directory doesn't exist or can't be read
    }

    return entries;
  }

  /**
   * Creates a package registry entry from scanned package data.
   *
   * @param scanned - Parsed package metadata and revahub config
   * @param path - Resolved package directory path
   * @param source - Package source category
   */
  private createRegistryEntry(
    scanned: ScannedPackage,
    path: string,
    source: PackageSource
  ): PackageRegistryEntry {
    const meta = scanned.revahub;

    const entry: PackageRegistryEntry = {
      name: scanned.name,
      version: scanned.version,
      label: meta.label,
      description: meta.description,
      type: meta.type,
      source,
      path,
      main: scanned.main,
      devMain: scanned.devMain,
      native: this.nativePackages.has(scanned.name),
      options: meta.options
    };

    if (meta.type === 'task') {
      entry.trigger = meta.trigger;
      entry.timeout = meta.timeout;
    }

    return entry;
  }

  /**
   * Reads package.json to find git-installed dependencies.
   *
   * @param workingDir - Working directory containing package.json
   */
  private async getGitPackages(workingDir: string): Promise<Set<string>> {
    const gitPackages = new Set<string>();

    try {
      const pkgPath = join(workingDir, 'package.json');
      const raw = await readFile(pkgPath, 'utf-8');
      const pkg = JSON.parse(raw);
      const deps = pkg.dependencies ?? {};

      for (const [name, version] of Object.entries(deps)) {
        const versionStr = String(version);
        // Git URLs include 'git+', 'github:', 'gitlab:', etc.
        if (
          versionStr.startsWith('git+') ||
          versionStr.startsWith('github:') ||
          versionStr.startsWith('gitlab:') ||
          versionStr.startsWith('bitbucket:') ||
          versionStr.includes('git@')
        ) {
          gitPackages.add(name);
        }
      }
    } catch {
      // Ignore errors
    }

    return gitPackages;
  }

  /**
   * Scans all package sources and populates the registry.
   *
   * @param options - Scan configuration
   */
  async scanAll(options: ScanOptions): Promise<Map<string, PackageRegistryEntry>> {
    const { workingDir, localPackagesDir } = options;

    this.clearRegistry();

    const gitPackages = await this.getGitPackages(workingDir);

    const nodeModulesDir = join(workingDir, 'node_modules');
    const npmEntries = await this.scanDirectory(nodeModulesDir, 'npm');

    for (const entry of npmEntries) {
      if (gitPackages.has(entry.name)) {
        entry.source = 'git';
      }

      this.packageRegistry.set(entry.name, entry);
    }

    const defaultLocalDir = join(workingDir, 'packages');
    const defaultLocalEntries = await this.scanDirectory(defaultLocalDir, 'local');
    for (const entry of defaultLocalEntries) {
      this.packageRegistry.set(entry.name, entry);
    }

    if (localPackagesDir && localPackagesDir !== defaultLocalDir) {
      const customLocalEntries = await this.scanDirectory(localPackagesDir, 'local');
      for (const entry of customLocalEntries) {
        this.packageRegistry.set(entry.name, entry);
      }
    }

    return this.packageRegistry;
  }

  /**
   * Registers a single package in the registry.
   *
   * @param packagePath - Path to the package directory
   * @param source - Package source type
   */
  async registerPackage(
    packagePath: string,
    source: PackageSource
  ): Promise<PackageRegistryEntry | null> {
    const scanned = await this.scanPackage(packagePath);
    if (!scanned) {
      return null;
    }

    const entry = this.createRegistryEntry(scanned, packagePath, source);
    this.packageRegistry.set(entry.name, entry);
    return entry;
  }

  /**
   * Removes a package from the registry by name.
   *
   * @param name - Package name
   */
  deregisterPackage(name: string): boolean {
    return this.packageRegistry.delete(name);
  }

  /**
   * Ensures all native packages are registered in the registry.
   * Uses Node's module resolution to find packages even when they're workspace-linked.
   * Should be called after scanAll() to ensure native packages are always available.
   *
   * @param workingDir - Working directory for package resolution
   */
  async ensureNativePackages(workingDir: string): Promise<void> {
    for (const pkgName of this.nativePackages) {
      // Skip if already registered
      if (this.packageRegistry.has(pkgName)) {
        continue;
      }

      try {
        const pkgPath = await this.resolvePackagePath(pkgName, workingDir);
        const entry = await this.registerPackage(pkgPath, 'npm');
        if (entry) {
          console.info(`Registered native package: ${pkgName}`);
        }
      } catch (err) {
        console.warn(`Failed to register native package ${pkgName}:`, err);
      }
    }
  }
}
