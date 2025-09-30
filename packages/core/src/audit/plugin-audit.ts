import { createChildLogger } from "../observability/logger.js";

const auditLogger = createChildLogger({ component: "plugin-audit" });

export type PluginAuditPhase = "STARTED" | "SUCCEEDED" | "RETRY" | "FAILED";

export interface PluginAuditEntry {
  timestamp: Date;
  pluginName: string;
  capabilityKey: string;
  actionDefinitionId?: string;
  triggerDefinitionId?: string;
  triggerEventId?: string;
  invocationId?: string;
  phase: PluginAuditPhase;
  message?: string;
  errorCode?: string;
  errorKind?: string;
  retryDelayMs?: number;
  attempt?: number;
}

export async function recordPluginActionAudit(entry: PluginAuditEntry) {
  auditLogger.info({ target: "action", ...entry }, "Plugin action audit");
}

export async function recordPluginTriggerAudit(entry: PluginAuditEntry) {
  auditLogger.info({ target: "trigger", ...entry }, "Plugin trigger audit");
}
