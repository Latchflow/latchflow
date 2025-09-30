import type { PluginExecutionKind } from "../services/context.js";
import { createChildLogger } from "../observability/logger.js";

const auditLogger = createChildLogger({ component: "plugin-service" });

export type PluginServiceCallOutcome = "SUCCEEDED" | "FAILED";

export interface PluginServiceCallAuditEntry {
  timestamp: Date;
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
  serviceKey: string;
  method: string;
  requestedScopes: string[];
  grantedScopes: string[];
  deniedScopes?: string[];
  outcome: PluginServiceCallOutcome;
  errorMessage?: string;
  errorKind?: string;
}

export async function recordPluginServiceCall(entry: PluginServiceCallAuditEntry) {
  auditLogger.info(entry, "Plugin core service call");
}
