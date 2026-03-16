/**
 * Shared types for module and task context objects, event payloads,
 * option definitions, and RPC protocol messages.
 */

// ── Option Definitions ──

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

// ── Trigger Config ──

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

// ── Revahub Package Metadata ──

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

// ── Event Payload ──

export interface EventPayload {
  module: string;
  instance: string;
  event: string;
  data: unknown;
  timestamp: number;
}

// ── Instance Proxy ──

/** RPC proxy — all methods return promises */
export type InstanceProxy = Record<string, (...args: unknown[]) => Promise<unknown>>;

// ── Module Context ──

export interface ModuleContext {
  emit: (eventName: string, data: unknown) => void;
  onDestroy: (fn: () => Promise<void> | void) => void;
  options: Record<string, unknown>;
  instances: {
    logger: InstanceProxy;
    database: InstanceProxy;
    [optionKey: string]: InstanceProxy | InstanceProxy[];
  };
}

// ── Task Context ──

export interface TaskContext {
  options: Record<string, unknown>;
  event?: EventPayload;
  background: (fn: () => Promise<void>) => void;
  instances: {
    logger: InstanceProxy;
    database: InstanceProxy;
    [optionKey: string]: InstanceProxy | InstanceProxy[];
  };
}

// ── Module Factory ──

export type ModuleFactory = (ctx: ModuleContext) => unknown | Promise<unknown>;

// ── Task Function ──

export type TaskFunction = (ctx: TaskContext) => unknown | Promise<unknown>;

// ── Worker Thread Messages ──

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

export interface WorkerShutdownMessage {
  type: 'shutdown';
}

export type WorkerInboundMessage = WorkerCallMessage | WorkerShutdownMessage;

export type WorkerOutboundMessage =
  | WorkerEventMessage
  | WorkerResultMessage
  | WorkerReadyMessage
  | WorkerErrorMessage
  | WorkerRpcMessage;

// ── Instance Status ──

export type InstanceStatus = 'running' | 'stopped' | 'crashed';

// ── Task Run Status ──

export type TaskRunStatus = 'running' | 'success' | 'failed' | 'timed_out';

// ── Trigger Type ──

export type TriggerType = 'event' | 'cron' | 'manual' | 'webhook';

// ── Task Config Options (stored in JSONB) ──

export interface TaskConfigOptions {
  trigger?: TriggerConfig;
  timeout?: number;
  autoRestart?: boolean;
  autoRetry?: boolean;
  maxRetries?: number;
  exposeWebhook?: boolean;
  [key: string]: unknown;
}
