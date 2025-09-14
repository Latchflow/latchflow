import type { PolicyEntry } from "./types.js";

// Route signature helper: use the same signature literal when registering routes
// e.g. server.get("/plugins", requirePermission("GET /plugins")(handler))
export type RouteSignature = `${"GET" | "POST" | "PUT" | "PATCH" | "DELETE"} ${string}`;

export const POLICY: Record<RouteSignature, PolicyEntry> = {
  // Admin plugin management
  "GET /plugins": { action: "read", resource: "plugin", v1AllowExecutor: true },
  "POST /plugins/install": { action: "manage", resource: "plugin" },
  "DELETE /plugins/:pluginId": { action: "delete", resource: "plugin" },
  "GET /capabilities": { action: "read", resource: "capability", v1AllowExecutor: true },

  // Admin stubs (can be refined as endpoints are implemented)
  "GET /admin/actions": { action: "read", resource: "action_def", v1AllowExecutor: true },
  "GET /admin/bundles": { action: "read", resource: "bundle", v1AllowExecutor: true },
  "POST /admin/bundles/:bundleId/build": { action: "update", resource: "bundle" },
  "GET /admin/bundles/:bundleId/build/status": {
    action: "read",
    resource: "bundle",
    v1AllowExecutor: true,
  },
  "GET /admin/bundles/:bundleId/assignments": {
    action: "read",
    resource: "bundle",
    v1AllowExecutor: true,
  },
  "GET /admin/recipients": { action: "read", resource: "recipient", v1AllowExecutor: true },
  "GET /admin/recipients/:recipientId/assignments": {
    action: "read",
    resource: "recipient",
    v1AllowExecutor: true,
  },
  "GET /admin/triggers": { action: "read", resource: "trigger_def", v1AllowExecutor: true },

  // Files
  "GET /files": { action: "read", resource: "file", v1AllowExecutor: true },
  "GET /files/:id": { action: "read", resource: "file", v1AllowExecutor: true },
  "GET /files/:id/download": { action: "read", resource: "file", v1AllowExecutor: true },
  "POST /files/upload": { action: "create", resource: "file" },
  "POST /files/upload-url": { action: "create", resource: "file" },
  "POST /files/commit": { action: "create", resource: "file" },
  "PATCH /files/:id/metadata": { action: "update", resource: "file" },
  "POST /files/:id/move": { action: "update", resource: "file" },
  "DELETE /files/:id": { action: "delete", resource: "file" },
  "POST /files/batch/delete": { action: "delete", resource: "file" },
  "POST /files/batch/move": { action: "update", resource: "file" },

  // Bundle objects (admin)
  "GET /bundles/:bundleId/objects": { action: "read", resource: "bundle", v1AllowExecutor: true },
  "POST /bundles/:bundleId/objects": { action: "update", resource: "bundle" },
  "PATCH /bundles/:bundleId/objects/:id": { action: "update", resource: "bundle" },
  "DELETE /bundles/:bundleId/objects/:id": { action: "delete", resource: "bundle" },
} as const;
