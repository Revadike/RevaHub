import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { getDatabase } from '../../db/index.js';
import { modules, tasks } from '../../db/schema.js';
import { resolvePackagePath, scanPackage } from '../../core/package-scanner.js';
import type { ServerDeps } from '../server.js';
import type { FastifyInstance } from 'fastify';
import type { RevahubMeta } from '../../types.js';

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
 * Registers marketplace API routes for package discovery, installation, and updates.
 * @param app - Fastify instance scoped to /api
 * @param deps - Core service dependencies
 */
export function registerMarketplaceRoutes(app: FastifyInstance, deps: ServerDeps) {
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

  // Install a package
  app.post<{ Body: { packageName: string } }>('/marketplace/install', async (req, reply) => {
    const { packageName } = req.body;

    if (!VALID_PACKAGE_NAME.test(packageName)) {
      return reply.code(400).send({ error: 'Invalid package name' });
    }

    try {
      await npmRun(['install', packageName], deps.workingDir);

      const packageDir = await resolvePackagePath(packageName, deps.workingDir);
      const scanned = await scanPackage(packageDir);
      if (!scanned) {
        return reply.code(400).send({ error: 'Package does not contain valid revahub metadata' });
      }

      const db = getDatabase();
      const meta = scanned.revahub as RevahubMeta;

      if (meta.type === 'module') {
        await db.insert(modules).values({
          name: scanned.name,
          version: scanned.version,
          label: meta.label,
          native: false
        })
          .onConflictDoUpdate({
            target: modules.name,
            set: { version: scanned.version, label: meta.label }
          });
      } else if (meta.type === 'task') {
        await db.insert(tasks).values({
          name: scanned.name,
          version: scanned.version,
          label: meta.label,
          native: false
        })
          .onConflictDoUpdate({
            target: tasks.name,
            set: { version: scanned.version, label: meta.label }
          });
      }

      return { success: true, name: scanned.name, version: scanned.version };
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

    const db = getDatabase();

    // Check if it's native
    if (packageName.startsWith('revahub-module-')) {
      const [mod] = await db.select().from(modules)
        .where(eq(modules.name, packageName));
      if (mod?.native) {
        return reply.code(403).send({ error: 'Cannot uninstall native module' });
      }
    } else if (packageName.startsWith('revahub-task-')) {
      const [task] = await db.select().from(tasks)
        .where(eq(tasks.name, packageName));
      if (task?.native) {
        return reply.code(403).send({ error: 'Cannot uninstall native task' });
      }
    }

    try {
      await npmRun(['uninstall', packageName], deps.workingDir);

      if (packageName.startsWith('revahub-module-')) {
        await db.delete(modules).where(eq(modules.name, packageName));
      } else if (packageName.startsWith('revahub-task-')) {
        await db.delete(tasks).where(eq(tasks.name, packageName));
      }

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

    try {
      await npmRun(['install', `${packageName}@latest`], deps.workingDir);

      const packageDir = await resolvePackagePath(packageName, deps.workingDir);
      const scanned = await scanPackage(packageDir);
      if (!scanned) {
        return reply.code(400).send({ error: 'Package scan failed after update' });
      }

      const db = getDatabase();
      if (packageName.startsWith('revahub-module-')) {
        await db.update(modules).set({ version: scanned.version })
          .where(eq(modules.name, packageName));
      } else if (packageName.startsWith('revahub-task-')) {
        await db.update(tasks).set({ version: scanned.version })
          .where(eq(tasks.name, packageName));
      }

      return { success: true, version: scanned.version };
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : 'Update failed' });
    }
  });
}
