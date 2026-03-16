import cron from 'node-cron';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { getDatabase } from '../db/index.js';
import { taskConfigs, taskRuns, tasks } from '../db/schema.js';
import { CoreEventBus } from './event-bus.js';
import { ModuleManager } from './module-manager.js';
import { resolvePackagePath, scanPackage } from './package-scanner.js';
import type {
  EventPayload,
  InstanceProxy,
  TaskConfigOptions,
  TaskContext,
  TaskFunction,
  TriggerType
} from '../types.js';

/**
 * Generates a prefixed unique ID.
 * @param prefix - Short prefix string
 */
function generateId(prefix: string): string {
  return `${prefix}_${randomBytes(6).toString('hex')}`;
}

/**
 * Orchestrates task execution including cron scheduling, event-driven
 * triggers, manual runs, and webhook invocations.
 */
export class TaskRunner {
  private cronJobs = new Map<string, cron.ScheduledTask>();
  private eventListener: ((payload: EventPayload) => void) | null = null;

  constructor(
    private eventBus: CoreEventBus,
    private moduleManager: ModuleManager,
    private workingDir: string
  ) {}

  /**
   * Sets up all task triggers from the database and subscribes to events.
   */
  async initialize() {
    await this.refreshCronJobs();
    this.subscribeToEvents();
  }

  /**
   * Refreshes all cron jobs based on current enabled task configs.
   */
  async refreshCronJobs() {
    // Stop all existing cron jobs
    for (const [, job] of this.cronJobs) {
      job.stop();
    }

    this.cronJobs.clear();

    const db = getDatabase();
    const configs = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.enabled, true));

    for (const config of configs) {
      const options = config.options as TaskConfigOptions;
      if (options.trigger?.type === 'cron' && options.trigger.cron) {
        this.scheduleCron(config.id, options.trigger.cron);
      }
    }
  }

  /**
   * Registers a cron job for a task config.
   * @param taskConfigId - The task config to schedule
   * @param cronExpression - Standard cron expression
   */
  private scheduleCron(taskConfigId: string, cronExpression: string) {
    if (!cron.validate(cronExpression)) {
      console.error(`[TaskRunner] Invalid cron expression "${cronExpression}" for task config "${taskConfigId}"`);
      return;
    }

    const job = cron.schedule(cronExpression, () => {
      void this.invoke(taskConfigId, 'cron');
    });

    this.cronJobs.set(taskConfigId, job);
  }

  /** Subscribes to the event bus and triggers matching task configs. */
  private subscribeToEvents() {
    this.eventListener = (payload: EventPayload) => {
      void this.handleEvent(payload);
    };

    this.eventBus.on(this.eventListener);
  }

  /**
   * Routes an event to all task configs that match the instance + event name.
   * @param payload - The event payload to match against task triggers
   */
  private async handleEvent(payload: EventPayload) {
    const db = getDatabase();
    const configs = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.enabled, true));

    for (const config of configs) {
      const options = config.options as TaskConfigOptions;
      if (
        options.trigger?.type === 'event' &&
        options.trigger.instance === payload.instance &&
        options.trigger.event === payload.event
      ) {
        void this.invoke(config.id, 'event', payload);
      }
    }
  }

  /**
   * Invokes a task config run.
   * @param taskConfigId - The task config to execute
   * @param triggerType - How the task was triggered
   * @param event - Optional event payload for event triggers
   * @param webhookBody - Optional webhook request body
   * @param retryCount - Current retry attempt
   */
  async invoke(
    taskConfigId: string,
    triggerType: TriggerType,
    event?: EventPayload,
    webhookBody?: unknown,
    retryCount = 0
  ): Promise<{ runId: string; result?: unknown; error?: string }> {
    const db = getDatabase();
    const [config] = await db.select().from(taskConfigs)
      .where(
        and(eq(taskConfigs.id, taskConfigId), eq(taskConfigs.enabled, true))
      );

    if (!config) {
      throw new Error(`Task config "${taskConfigId}" not found or disabled`);
    }

    const [task] = await db.select().from(tasks)
      .where(eq(tasks.name, config.taskName));
    if (!task) {
      throw new Error(`Task "${config.taskName}" not found`);
    }

    const options = config.options as TaskConfigOptions;

    // Create the task run record
    const runId = generateId('run');
    await db.insert(taskRuns).values({
      id: runId,
      taskConfigId,
      triggerType,
      triggerPayload: event ?? webhookBody ?? null,
      status: 'running',
      retryCount
    });

    try {
      // Build task context
      const backgroundFns: Array<() => Promise<void>> = [];

      const instances: Record<string, InstanceProxy | InstanceProxy[]> = {
        logger: this.moduleManager.createProxy('__native_logger__'),
        database: this.moduleManager.createProxy('__native_database__')
      };

      // Wire up connected instances from options
      const taskOptions: Record<string, unknown> = { ...options };
      delete taskOptions.trigger;
      delete taskOptions.timeout;
      delete taskOptions.autoRestart;
      delete taskOptions.autoRetry;
      delete taskOptions.maxRetries;
      delete taskOptions.exposeWebhook;

      for (const [key, value] of Object.entries(taskOptions)) {
        if (typeof value === 'string' && value.startsWith('inst_')) {
          // Verify connected instance is running before invocation
          const instanceStatus = this.moduleManager.getStatus(value);
          if (instanceStatus !== 'running') {
            throw new Error(`Required instance "${value}" (option "${key}") is not running (status: ${instanceStatus ?? 'unknown'})`);
          }

          instances[key] = this.moduleManager.createProxy(value);
        }
      }

      const ctx: TaskContext = {
        options: taskOptions,
        event,
        background(fn: () => Promise<void>) {
          backgroundFns.push(fn);
        },
        instances: instances as TaskContext['instances']
      };

      // Load and execute the task
      const taskDir = await resolvePackagePath(config.taskName, this.workingDir);
      const scanned = await scanPackage(taskDir);
      if (!scanned) {
        throw new Error(`Failed to scan task package "${config.taskName}"`);
      }

      const taskEntryPath = join(taskDir, scanned.main);
      const mod = await import(pathToFileURL(taskEntryPath).href);
      const taskFn: TaskFunction = mod.default?.default ?? mod.default;

      if (typeof taskFn !== 'function') {
        throw new Error(`Task "${config.taskName}" does not export a function`);
      }

      const timeoutMs = options.timeout ?? 0;

      const runTaskAndBackground = async () => {
        const result = await taskFn(ctx);

        // Store the early return value
        await db.update(taskRuns).set({ result: result as object })
          .where(eq(taskRuns.id, runId));

        // Wait for all background work
        if (backgroundFns.length > 0) {
          await Promise.all(backgroundFns.map((fn) => fn()));
        }

        return result;
      };

      let result: unknown;

      if (timeoutMs > 0) {
        result = await Promise.race([
          runTaskAndBackground(),
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('Task timed out')), timeoutMs);
          })
        ]);
      } else {
        result = await runTaskAndBackground();
      }

      // Success
      await db.update(taskRuns).set({
        status: 'success',
        result: result as object,
        finishedAt: new Date()
      })
        .where(eq(taskRuns.id, runId));

      // Auto-restart on success
      if (options.autoRestart) {
        void this.invoke(taskConfigId, triggerType, event);
      }

      return { runId, result: result as object };
    } catch (err) {
      const isTimeout = err instanceof Error && err.message === 'Task timed out';
      const status = isTimeout ? 'timed_out' : 'failed';
      const errorMessage = err instanceof Error ? err.message : String(err);

      await db.update(taskRuns).set({
        status,
        error: errorMessage,
        finishedAt: new Date()
      })
        .where(eq(taskRuns.id, runId));

      // Auto-retry on failure/timeout
      const maxRetries = options.maxRetries ?? 3;
      if (options.autoRetry && retryCount < maxRetries) {
        void this.invoke(taskConfigId, triggerType, event, webhookBody, retryCount + 1);
      }

      return { runId, error: errorMessage };
    }
  }

  /**
   * Returns all webhook-enabled task config IDs and their details.
   */
  async getWebhookConfigs(): Promise<Array<{ id: string; taskName: string }>> {
    const db = getDatabase();
    const configs = await db.select().from(taskConfigs)
      .where(eq(taskConfigs.enabled, true));

    return configs
      .filter((c) => (c.options as TaskConfigOptions).exposeWebhook)
      .map((c) => ({ id: c.id, taskName: c.taskName }));
  }

  /** Stops all cron jobs and unsubscribes from events. */
  async shutdown() {
    for (const [, job] of this.cronJobs) {
      job.stop();
    }

    this.cronJobs.clear();

    if (this.eventListener) {
      this.eventBus.off(this.eventListener);
      this.eventListener = null;
    }
  }
}
