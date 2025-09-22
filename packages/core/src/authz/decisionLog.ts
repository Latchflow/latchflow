// Minimal structured decision logging helper for AuthZ v1
// Intentionally framework-agnostic and stdout-only for now.

import { createAuthzLogger } from "../observability/logger.js";

export type DecisionEvent = {
  decision: "ALLOW" | "DENY";
  reason: string;
  signature?: string;
  resource?: string;
  action?: string;
  userId?: string;
  role?: string;
  requestId?: string;
  shadowMode?: boolean;
};

export function logDecision(ev: DecisionEvent) {
  // In v1 keep it lightweight; downstream can pipe stdout to JSON log storage.
  try {
    createAuthzLogger().info({ kind: "authz_decision", ...ev }, "Authorization decision");
  } catch {
    // ignore
  }
}
