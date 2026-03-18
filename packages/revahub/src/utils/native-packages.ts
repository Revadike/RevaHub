import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let cachedNativePackages: Set<string> | null = null;

/**
 * @returns Set of native package names
 */
export function getNativePackages(): Set<string> {
  if (cachedNativePackages) {
    return cachedNativePackages;
  }

  const packageJsonPath = join(__dirname, '..', '..', 'package.json');

  try {
    const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf-8'));
    const dependencies = packageJson.dependencies || {};

    const nativePackages = new Set<string>();
    for (const dep of Object.keys(dependencies)) {
      if (dep.startsWith('revahub-module-') || dep.startsWith('revahub-task-')) {
        nativePackages.add(dep);
      }
    }

    cachedNativePackages = nativePackages;
    return nativePackages;
  } catch (error) {
    console.error('Failed to read revahub package.json for native packages:', error);
    return new Set();
  }
}

/**
 * @returns Array of native module package names
 */
export function getNativeModules(): string[] {
  const packages = getNativePackages();
  return [...packages].filter(p => p.startsWith('revahub-module-'));
}

/**
 * @returns Array of native task package names
 */
export function getNativeTasks(): string[] {
  const packages = getNativePackages();
  return [...packages].filter(p => p.startsWith('revahub-task-'));
}

/**
 * @param name - Package name to check
 * @returns True if native
 */
export function isNativePackage(name: string): boolean {
  return getNativePackages().has(name);
}
