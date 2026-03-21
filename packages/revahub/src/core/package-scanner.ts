import { readFile, access, readdir, lstat, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';

import type { RevahubMeta, OptionDef, TriggerConfig, PackageSource } from 'revahub-types';

export interface ScannedPackage {
  name: string;
  version: string;
  main: string;
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
  native: boolean;
  options?: OptionDef[];
  trigger?: { default?: TriggerConfig };
  timeout?: { default?: number };
}

/** In-memory registry of all discovered packages. */
const packageRegistry = new Map<string, PackageRegistryEntry>();

/**
 * Returns the full package registry map.
 */
export function getPackageRegistry(): Map<string, PackageRegistryEntry> {
  return packageRegistry;
}

/**
 * Gets a package entry by name from the registry.
 *
 * @param name - Package name
 */
export function getPackage(name: string): PackageRegistryEntry | undefined {
  return packageRegistry.get(name);
}

/**
 * Clears all entries from the package registry.
 */
export function clearPackageRegistry() {
  packageRegistry.clear();
}

/**
 * Reads and parses a revahub package's metadata from its package.json.
 *
 * @param packageDir - Absolute path to the package directory
 * @returns Parsed package metadata or null if invalid
 */
export async function scanPackage(packageDir: string): Promise<ScannedPackage | null> {
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

    return {
      name: pkg.name,
      version: pkg.version,
      main: pkg.main ?? 'dist/index.js',
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
export async function resolvePackagePath(packageName: string, workingDir: string): Promise<string> {
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
 * @param nativePackages - Set of native package names
 * @returns Array of found package entries
 */
async function scanDirectory(
  dir: string,
  source: PackageSource,
  nativePackages: Set<string>
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
              const scanned = await scanPackage(resolvedPath);
              if (scanned) {
                entries.push(createRegistryEntry(scanned, resolvedPath, source, nativePackages));
              }
            }
          }
        } else if (stat.isDirectory() || stat.isSymbolicLink()) {
          // Regular package or symlink (for local packages)
          const resolvedPath = stat.isSymbolicLink()
            ? await realpath(itemPath)
            : itemPath;
          const scanned = await scanPackage(resolvedPath);
          if (scanned) {
            entries.push(createRegistryEntry(scanned, resolvedPath, source, nativePackages));
          }
        }
      } catch {
        // Skip items that can't be read
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
 * @param scanned - Scanned package data
 * @param path - Package path
 * @param source - Package source type
 * @param nativePackages - Set of native package names
 */
function createRegistryEntry(
  scanned: ScannedPackage,
  path: string,
  source: PackageSource,
  nativePackages: Set<string>
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
    native: nativePackages.has(scanned.name),
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
 * @param workingDir - Working directory
 */
async function getGitPackages(workingDir: string): Promise<Set<string>> {
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

export interface ScanOptions {
  workingDir: string;
  localPackagesDir: string | null;
  nativePackages: Set<string>;
}

/**
 * Scans all package sources and populates the registry.
 *
 * @param options - Scan configuration
 */
export async function scanAllPackages(options: ScanOptions): Promise<Map<string, PackageRegistryEntry>> {
  const { workingDir, localPackagesDir, nativePackages } = options;

  clearPackageRegistry();

  const gitPackages = await getGitPackages(workingDir);

  const nodeModulesDir = join(workingDir, 'node_modules');
  const npmEntries = await scanDirectory(nodeModulesDir, 'npm', nativePackages);

  for (const entry of npmEntries) {
    if (gitPackages.has(entry.name)) {
      entry.source = 'git';
    }

    packageRegistry.set(entry.name, entry);
  }

  const defaultLocalDir = join(workingDir, 'packages');
  const defaultLocalEntries = await scanDirectory(defaultLocalDir, 'local', nativePackages);
  for (const entry of defaultLocalEntries) {
    packageRegistry.set(entry.name, entry);
  }

  if (localPackagesDir && localPackagesDir !== defaultLocalDir) {
    const customLocalEntries = await scanDirectory(localPackagesDir, 'local', nativePackages);
    for (const entry of customLocalEntries) {
      packageRegistry.set(entry.name, entry);
    }
  }

  return packageRegistry;
}

/**
 * Registers a single package in the registry.
 *
 * @param packagePath - Path to the package directory
 * @param source - Package source type
 * @param nativePackages - Set of native package names
 */
export async function registerPackage(
  packagePath: string,
  source: PackageSource,
  nativePackages: Set<string>
): Promise<PackageRegistryEntry | null> {
  const scanned = await scanPackage(packagePath);
  if (!scanned) {
    return null;
  }

  const entry = createRegistryEntry(scanned, packagePath, source, nativePackages);
  packageRegistry.set(entry.name, entry);
  return entry;
}

/**
 * Removes a package from the registry by name.
 *
 * @param name - Package name
 */
export function deregisterPackage(name: string): boolean {
  return packageRegistry.delete(name);
}
