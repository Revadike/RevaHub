import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

import { eq } from 'drizzle-orm';
import type { InstanceProxy, InstanceStatus, WorkerOutboundMessage, CallerContext } from 'revahub-types';

import { CoreEventBus } from './event-bus.js';
import type { PackageScanner } from './package-scanner.js';
import { getDatabase, getPGlite } from '../db/index.js';
import { moduleInstances } from '../db/schema.js';
import { isDev } from '../utils/environment.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

interface ManagedInstance {
  id: string;
  moduleName: string;
  label: string;
  worker: Worker | null;
  status: InstanceStatus;
  methods: string[];
  pendingCalls: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>;
}

/**
 * Manages module instance lifecycles, spawning worker threads and
 * routing RPC calls and events between instances and the core.
 */
export class ModuleManager {
  private instances = new Map<string, ManagedInstance>();

  constructor(
    private eventBus: CoreEventBus,
    private scanner: PackageScanner,
    private workingDir: string
  ) {}

  /**
   * Starts all enabled instances from the database.
   */
  async startAll() {
    const db = getDatabase();
    const rows = await db
      .select()
      .from(moduleInstances)
      .where(eq(moduleInstances.enabled, true));

    for (const row of rows) {
      // Skip if status is 'missing' (package not found)
      if (row.status === 'missing') {
        console.warn(`Skipping instance "${row.id}" — package "${row.moduleName}" missing`);
        continue;
      }

      try {
        await this.startInstance(row.id);
      } catch (err) {
        console.error(`Failed to start instance "${row.id}":`, err);
      }
    }
  }

  /**
   * Starts a single module instance by its ID.
   *
   * @param instanceId - The unique instance identifier
   */
  async startInstance(instanceId: string) {
    const db = getDatabase();
    const [row] = await db
      .select()
      .from(moduleInstances)
      .where(eq(moduleInstances.id, instanceId));

    if (!row) {
      throw new Error(`Instance "${instanceId}" not found`);
    }

    // Check if module exists in registry
    const pkg = this.scanner.getPackage(row.moduleName);
    if (!pkg) {
      await db
        .update(moduleInstances)
        .set({ status: 'missing' })
        .where(eq(moduleInstances.id, instanceId));

      throw new Error(`Module "${row.moduleName}" not found in registry`);
    }

    // Resolve module entry point
    // In dev mode, use TypeScript source for native and local packages
    const useDevMain = isDev && pkg.devMain && (pkg.source === 'native' || pkg.source === 'local');
    const modulePath = join(pkg.path, useDevMain ? pkg.devMain! : pkg.main);

    const managed: ManagedInstance = {
      id: instanceId,
      moduleName: row.moduleName,
      label: row.label,
      worker: null,
      status: 'stopped',
      methods: [],
      pendingCalls: new Map()
    };

    this.instances.set(instanceId, managed);

    const connectedInstances: Record<string, string> = {};
    const options = (row.options ?? {}) as Record<string, unknown>;

    // Build connected instance mapping from instance-type options
    // The package metadata would define which options are instance-type,
    // but for now we detect keys that look like instance IDs
    for (const [key, value] of Object.entries(options)) {
      if (typeof value === 'string' && value.startsWith('inst_')) {
        connectedInstances[key] = value;
      }
    }

    // https://electrovir.com/2025-08-09-typescript-worker/
    const workerExt = isDev ? 'ts' : 'js';
    const workerPath = import.meta.resolve(`../worker/module-worker.${workerExt}`);
    const workerOptions: ConstructorParameters<typeof Worker>[1] = {
      workerData: {
        modulePath,
        options,
        instanceId,
        moduleName: row.moduleName,
        connectedInstances
      },
      eval: isDev
    };

    const worker = new Worker(
      isDev
        ? `import('tsx/esm/api').then(({ register }) => { register(); import('${workerPath}') })`
        : workerPath,
      workerOptions
    );

    managed.worker = worker;

    worker.on('message', (msg: WorkerOutboundMessage & { type: string; targetInstanceId?: string; method?: string; args?: unknown[]; correlationId?: string }) => {
      this.handleWorkerMessage(instanceId, msg);
    });

    worker.on('exit', (code) => {
      this.handleWorkerExit(instanceId, code);
    });

    worker.on('error', (err) => {
      console.error(`Worker error for instance "${instanceId}":`, err.message);
    });

    // Wait for ready or error
    return new Promise<void>((resolve, reject) => {
      const onReady = () => {
        managed.status = 'running';
        void db
          .update(moduleInstances)
          .set({ status: 'running' })
          .where(eq(moduleInstances.id, instanceId))
          .then(() => resolve());
      };

      const onError = (error: string) => {
        managed.status = 'crashed';
        void db
          .update(moduleInstances)
          .set({ status: 'crashed' })
          .where(eq(moduleInstances.id, instanceId))
          .then(() => reject(new Error(error)));
      };

      const messageHandler = (msg: WorkerOutboundMessage) => {
        if (msg.type === 'ready') {
          managed.methods = msg.methods;
          worker.off('message', messageHandler);
          onReady();
        } else if (msg.type === 'error') {
          worker.off('message', messageHandler);
          onError(msg.error);
        }
      };

      worker.on('message', messageHandler);
    });
  }

  /**
   * Stops a running instance gracefully.
   *
   * @param instanceId - The instance to stop
   */
  async stopInstance(instanceId: string) {
    const managed = this.instances.get(instanceId);
    if (!managed?.worker) {
      return;
    }

    managed.worker.postMessage({ type: 'shutdown' });

    await Promise.race([
      new Promise<void>((resolve) => {
        managed.worker!.once('exit', () => resolve());
      }),
      new Promise<void>((resolve) => {
        setTimeout(resolve, SHUTDOWN_TIMEOUT_MS);
      })
    ]);

    if (managed.worker) {
      await managed.worker.terminate();
    }

    managed.worker = null;
    managed.status = 'stopped';

    const db = getDatabase();
    await db
      .update(moduleInstances)
      .set({ status: 'stopped' })
      .where(eq(moduleInstances.id, instanceId));
  }

  /**
   * Calls a method on a running instance via RPC.
   *
   * @param instanceId - Target instance
   * @param method - Method name to invoke
   * @param args - Arguments to pass
   * @param callerContext - Optional caller context for tracing
   * @returns The method's return value
   */
  async callMethod(
    instanceId: string,
    method: string,
    args: unknown[],
    callerContext?: CallerContext
  ): Promise<unknown> {
    const managed = this.instances.get(instanceId);
    if (!managed?.worker || managed.status !== 'running') {
      throw new Error(`Instance "${instanceId}" is not running`);
    }

    const correlationId = `${Date.now()}-${Math
      .random()
      .toString(36)
      .slice(2, 9)}`;

    return new Promise((resolve, reject) => {
      managed.pendingCalls.set(correlationId, { resolve, reject });
      managed.worker!.postMessage({ type: 'call', correlationId, method, args, callerContext });
    });
  }

  /**
   * Creates an RPC proxy object for an instance, usable in task/module contexts.
   *
   * @param instanceId - Target instance to proxy
   * @param callerContext - Optional caller context to inject into all calls
   */
  createProxy(
    instanceId: string,
    callerContext?: CallerContext
  ): InstanceProxy {
    return new Proxy({} as InstanceProxy, {
      get: (_, method: string) => {
        return (...args: unknown[]) => this.callMethod(instanceId, method, args, callerContext);
      }
    });
  }

  /**
   * Returns the current status of an instance.
   *
   * @param instanceId - The instance to check
   */
  getStatus(instanceId: string): InstanceStatus | undefined {
    return this.instances.get(instanceId)?.status;
  }

  /**
   * Returns the public method names available on an instance.
   *
   * @param instanceId - The instance to query
   */
  getMethods(instanceId: string): string[] {
    return this.instances.get(instanceId)?.methods ?? [];
  }

  /**
   * Gracefully shuts down all running instances.
   */
  async shutdownAll() {
    const stopPromises = [...this.instances.keys()].map((id) => this.stopInstance(id));
    await Promise.allSettled(stopPromises);
  }

  private handleWorkerMessage(
    instanceId: string,
    msg: WorkerOutboundMessage & { type: string; targetInstanceId?: string; method?: string; args?: unknown[]; correlationId?: string; text?: string; params?: unknown[] }
  ) {
    const managed = this.instances.get(instanceId);
    if (!managed) {
      return;
    }

    switch (msg.type) {
      case 'event':
        if ('name' in msg) {
          this.eventBus.emit({
            module: managed.moduleName,
            instance: instanceId,
            event: msg.name,
            data: msg.data,
            timestamp: Date.now()
          });
        }

        break;

      case 'result':
        if ('correlationId' in msg) {
          const pending = managed.pendingCalls.get(msg.correlationId);
          if (pending) {
            managed.pendingCalls.delete(msg.correlationId);
            if (msg.error) {
              pending.reject(new Error(msg.error));
            } else {
              pending.resolve(msg.result);
            }
          }
        }

        break;

      // PGlite query from worker (used by native database module)
      case 'pglite-query':
        if (msg.correlationId && msg.text !== undefined) {
          void this.handlePGliteQuery(instanceId, msg.text, msg.params, msg.correlationId);
        }

        break;

      // Forwarded RPC from worker to another instance
      default:
        if (msg.type === 'rpc' && msg.targetInstanceId && msg.method && msg.correlationId) {
          const callerContext = (msg as { callerContext?: CallerContext }).callerContext;
          void this.forwardRpc(instanceId, msg.targetInstanceId, msg.method, msg.args ?? [], msg.correlationId, callerContext);
        }

        break;
    }
  }

  /**
   * Handles a PGlite query request from a worker.
   *
   * @param sourceInstanceId - The instance requesting the query
   * @param text - SQL query text
   * @param params - Query parameters
   * @param correlationId - Correlation ID for response
   */
  private async handlePGliteQuery(
    sourceInstanceId: string,
    text: string,
    params: unknown[] | undefined,
    correlationId: string
  ) {
    const source = this.instances.get(sourceInstanceId);
    if (!source?.worker) {
      return;
    }

    try {
      const pglite = getPGlite();
      if (!pglite) {
        throw new Error('PGlite database not initialized');
      }

      const result = await pglite.query(text, params);
      source.worker.postMessage({ type: 'pglite-result', correlationId, result });
    } catch (err) {
      source.worker.postMessage({
        type: 'pglite-result',
        correlationId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  /**
   * Forwards an RPC call from one instance to another.
   *
   * @param sourceInstanceId - The instance initiating the call
   * @param targetInstanceId - The instance to call
   * @param method - Method name to invoke
   * @param args - Method arguments
   * @param correlationId - Correlation ID for response
   * @param callerContext - Optional caller context for tracing
   */
  private async forwardRpc(
    sourceInstanceId: string,
    targetInstanceId: string,
    method: string,
    args: unknown[],
    correlationId: string,
    callerContext?: CallerContext
  ) {
    const source = this.instances.get(sourceInstanceId);
    if (!source?.worker) {
      return;
    }

    // If no caller context provided, the source module is the caller
    const effectiveContext = callerContext ?? { moduleInstanceId: sourceInstanceId };

    try {
      const result = await this.callMethod(targetInstanceId, method, args, effectiveContext);
      source.worker.postMessage({ type: 'result', correlationId, result });
    } catch (err) {
      source.worker.postMessage({
        type: 'result',
        correlationId,
        error: err instanceof Error ? err.message : String(err)
      });
    }
  }

  private handleWorkerExit(instanceId: string, code: number) {
    const managed = this.instances.get(instanceId);
    if (!managed) {
      return;
    }

    // Reject all pending calls
    for (const [, pending] of managed.pendingCalls) {
      pending.reject(new Error(`Worker exited with code ${code}`));
    }

    managed.pendingCalls.clear();
    managed.worker = null;

    if (managed.status === 'running') {
      managed.status = 'crashed';
      const db = getDatabase();
      void db
        .update(moduleInstances)
        .set({ status: 'crashed' })
        .where(eq(moduleInstances.id, instanceId));

      // Auto-restart if configured
      void this.maybeAutoRestart(instanceId);
    }
  }

  private async maybeAutoRestart(instanceId: string) {
    const db = getDatabase();
    const [row] = await db
      .select()
      .from(moduleInstances)
      .where(eq(moduleInstances.id, instanceId));

    if (row?.autoRestart && row.enabled) {
      console.info(`Auto-restarting instance "${instanceId}"`);
      try {
        await this.startInstance(instanceId);
      } catch (err) {
        console.error(`Auto-restart failed for "${instanceId}":`, err);
      }
    }
  }
}
