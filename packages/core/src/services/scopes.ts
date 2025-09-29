export const PLUGIN_SERVICE_SCOPES = {
  EMAIL_SEND: "email:send",
  USERS_WRITE: "users:write",
  BUNDLES_WRITE: "bundles:write",
  BUNDLE_ASSIGNMENTS_WRITE: "bundle_assignments:write",
  RECIPIENTS_WRITE: "recipients:write",
  ACTIONS_WRITE: "actions:write",
  TRIGGERS_WRITE: "triggers:write",
  PIPELINES_WRITE: "pipelines:write",
  STORAGE_LINK: "storage:link",
} as const;

export type PluginServiceScope = (typeof PLUGIN_SERVICE_SCOPES)[keyof typeof PLUGIN_SERVICE_SCOPES];

export const ALL_PLUGIN_SERVICE_SCOPES: PluginServiceScope[] = Object.values(PLUGIN_SERVICE_SCOPES);
