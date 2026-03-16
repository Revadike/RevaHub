import { readFile, access } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createRequire } from 'node:module';
import type { RevahubMeta } from '../types.js';

export interface ScannedPackage {
  name: string;
  version: string;
  main: string;
  revahub: RevahubMeta;
}

/**
 * Reads and parses a revahub package's metadata from its package.json.
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
 * @param packageName - npm package name
 * @param workingDir - The working directory where packages are installed
 */
export async function resolvePackagePath(packageName: string, workingDir: string): Promise<string> {
  // 1. Check working directory (production path)
  const workingDirPath = join(workingDir, 'node_modules', packageName);
  try {
    await access(join(workingDirPath, 'package.json'));
    return workingDirPath;
  } catch {
    // Not found in working dir
  }

  // 2. Try Node module resolution from the working directory
  try {
    const require = createRequire(join(workingDir, 'package.json'));
    const resolved = require.resolve(join(packageName, 'package.json'));
    return dirname(resolved);
  } catch {
    // Not found via working dir require
  }

  // 3. Try Node module resolution from the process context (workspace/dev)
  try {
    const require = createRequire(join(process.cwd(), 'package.json'));
    const resolved = require.resolve(join(packageName, 'package.json'));
    return dirname(resolved);
  } catch {
    // Not found via process cwd require
  }

  // 4. Last resort: return the working dir path (will fail downstream with a clear error)
  return workingDirPath;
}
