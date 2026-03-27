import { AsyncLocalStorage } from 'node:async_hooks';
import { pathToFileURL } from 'node:url';
import { parentPort, workerData } from 'node:worker_threads';

import type {
  CallerContext,
  ModuleContext,
  ModuleFactory,
  ModuleInstances,
  WorkerCallMessage,
  WorkerInboundMessage
} from 'revahub-types';

import { generateId } from '../utils/crypto.js';

if (!parentPort) {
  throw new Error('module-worker must run inside a Worker thread');
}

const port = parentPort;

interface WorkerBootstrapData {
  modulePath: string;
  options: Record<string, unknown>;
  instanceId: string;
  moduleName: string;
  connectedInstances: Record<string, string>;
}

const data = workerData as WorkerBootstrapData;
const destroyCallbacks: Array<() => Promise<void> | void> = [];
const callerContextStore = new AsyncLocalStorage<CallerContext>();

/**
 * Creates an RPC proxy for calling methods on another module instance
 * via the main thread.
 *
 * @param targetInstanceId - Instance ID to proxy calls to
 */
function createInstanceProxy(targetInstanceId: string): Record<string, (...args: unknown[]) => Promise<unknown>> {
  return new Proxy({} as Record<string, (...args: unknown[]) => Promise<unknown>>, {
    get(_, method: string) {
      return (...args: unknown[]) => {
        const correlationId = generateId('rpc');

        return new Promise((resolve, reject) => {
          const handler = (msg: { type: string; correlationId: string; result?: unknown; error?: string }) => {
            if (msg.type === 'result' && msg.correlationId === correlationId) {
              port.off('message', handler);
              if (msg.error) {
                reject(new Error(msg.error));
              } else {
                resolve(msg.result);
              }
            }
          };

          port.on('message', handler);
          port.postMessage({
            type: 'rpc',
            targetInstanceId,
            method,
            args,
            correlationId,
            callerContext: callerContextStore.getStore()
          });
        });
      };
    }
  });
}

/**
 * Creates a proxy for executing PGlite database queries via the main thread.
 */
function createPGliteProxy() {
  return {
    async query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }> {
      const correlationId = generateId('pglite');

      return new Promise((resolve, reject) => {
        const handler = (msg: { type: string; correlationId: string; result?: unknown; error?: string }) => {
          if (msg.type === 'pglite-result' && msg.correlationId === correlationId) {
            port.off('message', handler);
            if (msg.error) {
              reject(new Error(msg.error));
            } else {
              resolve(msg.result as { rows: T[] });
            }
          }
        };

        port.on('message', handler);
        port.postMessage({
          type: 'pglite-query',
          text,
          params,
          correlationId
        });
      });
    }
  };
}

const ctx: ModuleContext = {
  instanceId: data.instanceId,
  options: data.options,
  emit(eventName: string, eventData: unknown) {
    port.postMessage({ type: 'event', name: eventName, data: eventData });
  },
  onDestroy(fn: () => Promise<void> | void) {
    destroyCallbacks.push(fn);
  },
  instances: {
    logger: createInstanceProxy('inst_logger') as unknown as ModuleInstances['logger'],
    database: createInstanceProxy('inst_database') as unknown as ModuleInstances['database'],
    pglite: createPGliteProxy()
  },
  getCallerContext: () => callerContextStore.getStore()
};

// Wire up any connected instance proxies
for (const [key, instanceId] of Object.entries(data.connectedInstances)) {
  ctx.instances[key] = createInstanceProxy(instanceId);
}

let instance: Record<string, unknown> | null = null;

/**
 * Handles an RPC call from the main thread by invoking the method on the
 * module instance.
 *
 * @param msg - The call message with method name and arguments
 */
async function handleCall(msg: WorkerCallMessage) {
  try {
    if (!instance) {
      throw new Error('Instance not initialized');
    }

    const method = instance[msg.method];
    if (typeof method !== 'function') {
      throw new Error(`Method "${msg.method}" not found on instance`);
    }

    const callerContext = msg.callerContext ?? {};
    const result = await callerContextStore.run(callerContext, async () => {
      return (method as (...args: unknown[]) => unknown).call(instance, ...msg.args);
    });

    port.postMessage({ type: 'result', correlationId: msg.correlationId, result });
  } catch (err) {
    port.postMessage({
      type: 'result',
      correlationId: msg.correlationId,
      error: err instanceof Error ? err.message : String(err)
    });
  }
}

/**
 * Runs all registered destroy callbacks in order.
 */
async function handleShutdown() {
  for (const fn of destroyCallbacks) {
    try {
      await fn();
    } catch {
      // Best-effort cleanup
    }
  }

  process.exit(0);
}

port.on('message', (msg: WorkerInboundMessage) => {
  if (msg.type === 'call') {
    void handleCall(msg);
  } else if (msg.type === 'shutdown') {
    void handleShutdown();
  }
});

/**
 * Bootstrap the module
 */
async function bootstrap() {
  try {
    const mod = await import(pathToFileURL(data.modulePath).href);
    const factory: ModuleFactory = mod.default?.default ?? mod.default;

    if (typeof factory !== 'function') {
      throw new Error(`Module "${data.moduleName}" does not export a factory function`);
    }

    const result = await factory(ctx);
    instance = result as Record<string, unknown>;

    // Detect public methods — walk prototype chain for class-based modules
    const methods = new Set<string>();
    let obj: object | null = instance;
    while (obj && obj !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(obj)) {
        if (key !== 'constructor' && typeof (instance as Record<string, unknown>)[key] === 'function') {
          methods.add(key);
        }
      }

      obj = Object.getPrototypeOf(obj) as object | null;
    }

    port.postMessage({ type: 'ready', methods: [...methods] });
  } catch (err) {
    port.postMessage({
      type: 'error',
      error: err instanceof Error ? err.message : String(err)
    });
    process.exit(1);
  }
}

void bootstrap();
