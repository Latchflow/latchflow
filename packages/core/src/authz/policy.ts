import type { PolicyEntry } from "./types.js";

// Route signature helper: use the same signature literal when registering routes
// e.g. server.get("/plugins", requirePermission("GET /plugins")(handler))
export type RouteSignature = `${"GET" | "POST" | "PUT" | "DELETE"} ${string}`;

export const POLICY: Record<RouteSignature, PolicyEntry> = {
  // Admin plugin management
  "GET /plugins": { action: "read", resource: "plugin", v1AllowExecutor: true },
  "POST /plugins/install": { action: "manage", resource: "plugin" },
  "DELETE /plugins/:pluginId": { action: "delete", resource: "plugin" },
  "GET /capabilities": { action: "read", resource: "capability", v1AllowExecutor: true },

  // Admin stubs (can be refined as endpoints are implemented)
  "GET /admin/actions": { action: "read", resource: "action_def", v1AllowExecutor: true },
  "GET /admin/bundles": { action: "read", resource: "bundle", v1AllowExecutor: true },
  "GET /admin/recipients": { action: "read", resource: "recipient", v1AllowExecutor: true },
  "GET /admin/triggers": { action: "read", resource: "trigger_def", v1AllowExecutor: true },
} as const;
