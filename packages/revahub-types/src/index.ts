/**
 * Shared types for RevaHub modules and tasks.
 * This package contains zero runtime code — only TypeScript interfaces.
 */

export type OptionType = 'string' | 'number' | 'boolean' | 'secret' | 'select' | 'instance' | 'trigger';

export interface ConstraintOperators {
  notEmpty?: boolean;
  eq?: unknown;
  neq?: unknown;
}

export interface BaseOptionDef {
  key: string;
  type: OptionType;
  label: string;
  required?: boolean;
  default?: unknown;
  order?: number;
  secret?: boolean;
  choices?: Array<{ label: string; value: string | number }>;
}

export interface InstanceOptionDef extends BaseOptionDef {
  type: 'instance';
  module: string;
  multi?: boolean;
  constraints?: Record<string, ConstraintOperators>;
}

export type OptionDef = BaseOptionDef | InstanceOptionDef;

export interface CronTriggerConfig {
  type: 'cron';
  cron: string;
}

export interface EventTriggerConfig {
  type: 'event';
  instance: string;
  event: string;
}

export type TriggerConfig = CronTriggerConfig | EventTriggerConfig;

export interface RevahubModuleMeta {
  type: 'module';
  label: string;
  description?: string;
  options?: OptionDef[];
}

export interface RevahubTaskMeta {
  type: 'task';
  label: string;
  description?: string;
  options?: OptionDef[];
  trigger?: { default?: TriggerConfig };
  timeout?: { default?: number };
}

export type RevahubMeta = RevahubModuleMeta | RevahubTaskMeta;

export interface EventPayload {
  module: string;
  instance: string;
  event: string;
  data: unknown;
  timestamp: number;
}

// RPC proxy — all methods return promises
export type InstanceProxy = Record<string, (...args: unknown[]) => Promise<unknown>>;

export interface LoggerInstance {
  info(message: string, data?: unknown): Promise<void>;
  warn(message: string, data?: unknown): Promise<void>;
  error(message: string, data?: unknown): Promise<void>;
  debug(message: string, data?: unknown): Promise<void>;
}

export interface DatabaseInstance {
  query(text: string, params?: unknown[]): Promise<unknown[]>;
  queryOne(text: string, params?: unknown[]): Promise<unknown | null>;
}

export interface PGliteProxy {
  query<T = Record<string, unknown>>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
}

export interface ModuleInstances {
  logger: LoggerInstance;
  database: DatabaseInstance;
  [optionKey: string]: InstanceProxy | InstanceProxy[] | LoggerInstance | DatabaseInstance;
}

export interface ModuleContext {
  emit: (eventName: string, data: unknown) => void;
  onDestroy: (fn: () => Promise<void> | void) => void;
  options: Record<string, unknown>;
  instances: ModuleInstances;
}

export interface TaskContext {
  options: Record<string, unknown>;
  event?: EventPayload;
  background: (fn: () => Promise<void>) => void;
  instances: ModuleInstances;
}

export type ModuleFactory = (ctx: ModuleContext) => unknown | Promise<unknown>;

export type TaskFunction = (ctx: TaskContext) => unknown | Promise<unknown>;

export interface WorkerEventMessage {
  type: 'event';
  name: string;
  data: unknown;
}

export interface WorkerCallMessage {
  type: 'call';
  correlationId: string;
  method: string;
  args: unknown[];
}

export interface WorkerResultMessage {
  type: 'result';
  correlationId: string;
  result?: unknown;
  error?: string;
}

export interface WorkerReadyMessage {
  type: 'ready';
  methods: string[];
}

export interface WorkerErrorMessage {
  type: 'error';
  error: string;
}

export interface WorkerRpcMessage {
  type: 'rpc';
  correlationId: string;
  targetInstanceId: string;
  method: string;
  args?: unknown[];
}

export interface WorkerPGliteQueryMessage {
  type: 'pglite-query';
  correlationId: string;
  text: string;
  params?: unknown[];
}

export interface WorkerShutdownMessage {
  type: 'shutdown';
}

export type WorkerInboundMessage = WorkerCallMessage | WorkerShutdownMessage;

export type WorkerOutboundMessage =
  | WorkerEventMessage
  | WorkerResultMessage
  | WorkerReadyMessage
  | WorkerErrorMessage
  | WorkerRpcMessage
  | WorkerPGliteQueryMessage;

export type InstanceStatus = 'running' | 'stopped' | 'crashed' | 'missing';

export type TaskRunStatus = 'running' | 'success' | 'failed' | 'timed_out';

export type TriggerType = 'event' | 'cron' | 'manual' | 'webhook';

export interface TaskConfigOptions {
  trigger?: TriggerConfig;
  timeout?: number;
  autoRestart?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
  exposeWebhook?: boolean;
  [key: string]: unknown;
}

export type PackageSource = 'npm' | 'local' | 'git' | 'native';

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

export interface ModuleInstanceRow {
  id: string;
  moduleName: string;
  label: string;
  options: Record<string, unknown>;
  enabled: boolean;
  autoRestart: boolean;
  status: InstanceStatus;
  createdAt: Date;
}

export interface TaskRow {
  id: string;
  taskName: string;
  label: string;
  options: TaskConfigOptions;
  enabled: boolean;
  createdAt: Date;
  status?: InstanceStatus;
}

export interface TaskRunRow {
  id: string;
  taskId: string;
  triggerType: TriggerType;
  triggerPayload: unknown;
  status: TaskRunStatus;
  result: unknown;
  error: string | null;
  retryCount: number;
  startedAt: Date;
  finishedAt: Date | null;
}

export interface LogRow {
  id: string;
  level: string;
  message: string;
  data: unknown;
  taskRunId: string | null;
  moduleInstanceId: string | null;
  timestamp: Date;
}

export interface SettingRow {
  key: string;
  value: unknown;
}
