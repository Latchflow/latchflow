// Initial coarse-grained scopes for CLI bearer tokens.
// Keep small and explicit; no wildcards for v1.

export const SCOPES = {
  CORE_READ: "core:read",
  CORE_WRITE: "core:write",
  FILES_READ: "files:read",
  FILES_WRITE: "files:write",
  BUNDLES_READ: "bundles:read",
  BUNDLES_WRITE: "bundles:write",
  PLUGINS_READ: "plugins:read",
  PLUGINS_MANAGE: "plugins:manage",
  TRIGGERS_READ: "triggers:read",
  TRIGGERS_WRITE: "triggers:write",
  ACTIONS_READ: "actions:read",
  ACTIONS_WRITE: "actions:write",
  PIPELINES_READ: "pipelines:read",
  PIPELINES_WRITE: "pipelines:write",
  CAPABILITIES_READ: "capabilities:read",
} as const;

export type Scope = (typeof SCOPES)[keyof typeof SCOPES];

// Simple helpers for scope evaluation
export function hasAll(required: string[], granted: string[]): boolean {
  if (!required || required.length === 0) return true;
  if (!granted || granted.length === 0) return false;
  const set = new Set(granted);
  return required.every((s) => set.has(s));
}

export function hasAny(required: string[], granted: string[]): boolean {
  if (!required || required.length === 0) return true;
  if (!granted || granted.length === 0) return false;
  const set = new Set(granted);
  return required.some((s) => set.has(s));
}
