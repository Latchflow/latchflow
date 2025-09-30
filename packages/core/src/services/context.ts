export type PluginExecutionKind = "action" | "trigger" | "register" | "lifecycle";

export interface PluginServiceContext {
  pluginName: string;
  pluginId?: string;
  capabilityId: string;
  capabilityKey: string;
  executionKind: PluginExecutionKind;
  definitionId?: string;
  invocationId?: string;
  triggerEventId?: string;
  manualInvokerId?: string;
  correlationId?: string;
  timestamp: Date;
}

export interface PluginServiceCallMetadata {
  requestedScopes: string[];
  grantedScopes: string[];
  deniedScopes?: string[];
}

export type PluginServiceCallContext = PluginServiceContext & Partial<PluginServiceCallMetadata>;
