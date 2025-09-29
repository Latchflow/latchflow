import { z } from "zod";

export const CapabilityKindSchema = z.enum(["TRIGGER", "ACTION"]);

export const CapabilitySchema = z.object({
  kind: CapabilityKindSchema,
  key: z.string().min(1),
  displayName: z.string().min(1),
  // Arbitrary JSON schema object for plugin-specific config. Stored as-is.
  configSchema: z.unknown().optional(),
});

export const CapabilityArraySchema = z.array(CapabilitySchema);

export type Capability = z.infer<typeof CapabilitySchema>;

export type TriggerCapability = Capability & { kind: "TRIGGER" };

export type ActionCapability = Capability & { kind: "ACTION" };

export interface PluginLogger {
  debug(obj: unknown, msg?: string): void;
  info(obj: unknown, msg?: string): void;
  warn(obj: unknown, msg?: string): void;
  error(obj: unknown, msg?: string): void;
}

export interface PluginIdentifier {
  name: string;
}

export interface PluginRuntimeServices {
  logger: PluginLogger;
}

export interface TriggerEmitPayload {
  context?: Record<string, unknown>;
  scheduledFor?: Date;
  metadata?: Record<string, unknown>;
}

export type TriggerEmitFn = (payload?: TriggerEmitPayload) => Promise<void>;

export interface TriggerRuntimeServices extends PluginRuntimeServices {
  emit: TriggerEmitFn;
}

export interface TriggerRuntimeContext {
  definitionId: string;
  capability: TriggerCapability;
  plugin: PluginIdentifier;
  config: unknown;
  secrets?: Record<string, unknown> | null;
  services: TriggerRuntimeServices;
}

export interface TriggerRuntime {
  start(): Promise<void>;
  stop(): Promise<void>;
  onConfigChange?(config: unknown): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export type TriggerFactory = (
  ctx: TriggerRuntimeContext,
) => Promise<TriggerRuntime> | TriggerRuntime;

export interface ActionRuntimeServices extends PluginRuntimeServices {}

export interface ActionRuntimeContext {
  definitionId: string;
  capability: ActionCapability;
  plugin: PluginIdentifier;
  services: ActionRuntimeServices;
}

export interface ActionInvocationContext {
  invocationId: string;
  triggerEventId?: string;
  manualInvokerId?: string;
  context?: Record<string, unknown>;
}

export interface ActionExecutionInput {
  config: unknown;
  secrets?: Record<string, unknown> | null;
  payload?: Record<string, unknown>;
  invocation: ActionInvocationContext;
}

export interface ActionExecutionResult {
  output?: unknown;
  retry?: { delayMs?: number; reason?: string };
}

export interface ActionRuntime {
  execute(input: ActionExecutionInput): Promise<ActionExecutionResult | void>;
  dispose?(): Promise<void> | void;
}

export type ActionFactory = (ctx: ActionRuntimeContext) => Promise<ActionRuntime> | ActionRuntime;

export interface PluginModule {
  name?: string;
  capabilities: Capability[];
  triggers?: Record<string, TriggerFactory>;
  actions?: Record<string, ActionFactory>;
  register?(ctx: {
    plugin: PluginIdentifier;
    services: PluginRuntimeServices;
  }): Promise<void> | void;
  dispose?(): Promise<void> | void;
}

export function isTriggerCapability(capability: Capability): capability is TriggerCapability {
  return capability.kind === "TRIGGER";
}

export function isActionCapability(capability: Capability): capability is ActionCapability {
  return capability.kind === "ACTION";
}

export function isPluginModule(value: unknown): value is PluginModule {
  if (!value || typeof value !== "object") return false;
  const maybe = value as Record<string, unknown>;
  if (!Array.isArray(maybe.capabilities)) return false;
  return true;
}
