import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, symlink, rm, readdir } from 'node:fs/promises';
import { join, resolve as resolvePath, basename } from 'node:path';

import type { FastifyInstance } from 'fastify';

import { getPackage, registerPackage, deregisterPackage, scanPackage } from '../../core/package-scanner.js';
import type { ServerDeps } from '../server.js';

/** Strict validation pattern for npm package names in the revahub namespace. */
const VALID_PACKAGE_NAME = /^revahub-(module|task)-[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/;

/** Runs an npm command with array arguments to prevent shell injection. */
function npmRun(args: string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', args, { cwd, shell: false, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `npm exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Runs git clone to download a repository.
 *
 * @param url - Git URL to clone
 * @param dest - Destination path
 */
function gitClone(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', url, dest], { shell: false, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `git exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Runs git pull in a repository.
 *
 * @param cwd - Working directory
 */
function gitPull(cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['pull'], { cwd, shell: false, stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr || `git exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

/**
 * Registers marketplace API routes for package discovery, installation, and updates.
 *
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerMarketplaceRoutes(app: FastifyInstance, deps: ServerDeps) {
  const packagesDir = join(deps.workingDir, 'packages');

  // Search npm for revahub packages
  app.get<{ Querystring: { q?: string } }>('/marketplace/search', async (req) => {
    const query = req.query.q ?? 'revahub';
    const url = new URL('https://registry.npmjs.org/-/v1/search');
    url.searchParams.set('text', `keywords:revahub ${query}`);
    url.searchParams.set('size', '50');

    const response = await fetch(url.toString());
    const data = await response.json() as { objects: Array<{ package: { name: string; version: string; description: string } }> };

    // Filter to only revahub-module-* and revahub-task-* packages
    const results = data.objects
      .filter((obj) => {
        const name = obj.package.name;
        return name.startsWith('revahub-module-') || name.startsWith('revahub-task-');
      })
      .map((obj) => ({
        name: obj.package.name,
        version: obj.package.version,
        description: obj.package.description
      }));

    return results;
  });

  // Install a package from npm
  app.post<{ Body: { packageName: string } }>('/marketplace/install', async (req, reply) => {
    const { packageName } = req.body;

    if (!VALID_PACKAGE_NAME.test(packageName)) {
      return reply.code(400).send({ error: 'Invalid package name' });
    }

    try {
      await npmRun(['install', packageName], deps.workingDir);
      // npm packages are installed to node_modules
      const packagePath = join(deps.workingDir, 'node_modules', packageName);
      const entry = await registerPackage(packagePath, 'npm', deps.nativePackages);
      if (!entry) {
        return reply.code(400).send({ error: 'Package does not contain valid revahub metadata' });
      }

      return { success: true, name: entry.name, version: entry.version };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Installation failed' });
    }
  });

  // Uninstall a package
  app.post<{ Body: { packageName: string } }>('/marketplace/uninstall', async (req, reply) => {
    const { packageName } = req.body;

    if (!VALID_PACKAGE_NAME.test(packageName)) {
      return reply.code(400).send({ error: 'Invalid package name' });
    }

    const pkg = getPackage(packageName);
    if (pkg?.source === 'native') {
      return reply.code(403).send({ error: 'Cannot uninstall native package' });
    }

    try {
      // Handle based on source
      if (pkg?.source === 'local' || pkg?.source === 'git') {
        // Remove from packages directory
        const pkgDir = join(packagesDir, packageName);
        if (existsSync(pkgDir)) {
          await rm(pkgDir, { recursive: true, force: true });
        }
      } else {
        // npm package
        await npmRun(['uninstall', packageName], deps.workingDir);
      }

      deregisterPackage(packageName);
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Uninstallation failed' });
    }
  });

  // Update a package
  app.post<{ Body: { packageName: string } }>('/marketplace/update', async (req, reply) => {
    const { packageName } = req.body;

    if (!VALID_PACKAGE_NAME.test(packageName)) {
      return reply.code(400).send({ error: 'Invalid package name' });
    }

    const pkg = getPackage(packageName);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    try {
      let packagePath: string;
      if (pkg.source === 'git') {
        // Pull latest for git packages
        packagePath = join(packagesDir, packageName);
        await gitPull(packagePath);
      } else if (pkg.source === 'npm') {
        // npm update
        await npmRun(['install', `${packageName}@latest`], deps.workingDir);
        packagePath = join(deps.workingDir, 'node_modules', packageName);
      } else {
        return reply.code(400).send({ error: 'Cannot update local or native packages' });
      }

      // Re-scan to update registry
      const entry = await registerPackage(packagePath, pkg.source, deps.nativePackages);
      return { success: true, version: entry?.version };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });

  // Import local package by path (symlink)
  app.post<{ Body: { path: string } }>('/marketplace/import/local', async (req, reply) => {
    const { path } = req.body;

    if (!path) {
      return reply.code(400).send({ error: 'Path is required' });
    }

    const absPath = resolvePath(path);
    if (!existsSync(absPath)) {
      return reply.code(404).send({ error: 'Path does not exist' });
    }

    // Scan to validate
    const scanned = await scanPackage(absPath);
    if (!scanned) {
      return reply.code(400).send({ error: 'Invalid revahub package at path' });
    }

    try {
      await mkdir(packagesDir, { recursive: true });
      const linkPath = join(packagesDir, scanned.name);

      // Remove existing if present
      if (existsSync(linkPath)) {
        await rm(linkPath, { recursive: true, force: true });
      }

      await symlink(absPath, linkPath, 'dir');
      const entry = await registerPackage(linkPath, 'local', deps.nativePackages);
      return { success: true, package: entry };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Import failed' });
    }
  });

  // Import from git URL
  app.post<{ Body: { url: string; name?: string } }>('/marketplace/import/git', async (req, reply) => {
    const { url, name } = req.body;

    if (!url) {
      return reply.code(400).send({ error: 'Git URL is required' });
    }

    // Derive package name from URL if not provided
    const derivedName = name || basename(url, '.git');

    try {
      await mkdir(packagesDir, { recursive: true });
      const cloneDir = join(packagesDir, derivedName);

      if (existsSync(cloneDir)) {
        return reply.code(409).send({ error: 'Package directory already exists' });
      }

      await gitClone(url, cloneDir);

      // Validate after clone
      const scanned = await scanPackage(cloneDir);
      if (!scanned) {
        await rm(cloneDir, { recursive: true, force: true });
        return reply.code(400).send({ error: 'Cloned repo is not a valid revahub package' });
      }

      const entry = await registerPackage(cloneDir, 'git', deps.nativePackages);
      return { success: true, package: entry };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Git import failed' });
    }
  });

  // Pull latest for git packages
  app.post<{ Body: { packageName: string } }>('/marketplace/pull', async (req, reply) => {
    const { packageName } = req.body;

    const pkg = getPackage(packageName);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    if (pkg.source !== 'git') {
      return reply.code(400).send({ error: 'Only git packages can be pulled' });
    }

    try {
      const pkgDir = join(packagesDir, packageName);
      await gitPull(pkgDir);

      // Re-scan
      const entry = await registerPackage(pkgDir, 'git', deps.nativePackages);
      return { success: true, version: entry?.version };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Pull failed' });
    }
  });

  // Remove local/git package
  app.post<{ Body: { packageName: string } }>('/marketplace/remove-local', async (req, reply) => {
    const { packageName } = req.body;

    const pkg = getPackage(packageName);
    if (!pkg) {
      return reply.code(404).send({ error: 'Package not found' });
    }

    if (pkg.source !== 'local' && pkg.source !== 'git') {
      return reply.code(400).send({ error: 'Only local and git packages can be removed this way' });
    }

    try {
      const pkgDir = join(packagesDir, packageName);
      if (existsSync(pkgDir)) {
        await rm(pkgDir, { recursive: true, force: true });
      }

      deregisterPackage(packageName);
      return { success: true };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Remove failed' });
    }
  });

  // List local packages
  app.get('/marketplace/local', async (_req, reply) => {
    try {
      if (!existsSync(packagesDir)) {
        return [];
      }

      const entries = await readdir(packagesDir, { withFileTypes: true });
      const packages = [];
      for (const entry of entries) {
        if (entry.isDirectory() || entry.isSymbolicLink()) {
          const pkgPath = join(packagesDir, entry.name);
          const scanned = await scanPackage(pkgPath);
          if (scanned) {
            const registered = getPackage(scanned.name);
            packages.push({
              name: scanned.name,
              version: scanned.version,
              source: registered?.source ?? 'local',
              path: pkgPath
            });
          }
        }
      }
      return packages;
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Failed to list local packages' });
    }
  });
}
