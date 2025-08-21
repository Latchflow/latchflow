import type { RouteDescriptor } from "../types.js";

export const listPlugins = (): RouteDescriptor => ({
  method: "GET",
  path: "/plugins",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const getPlugin = (): RouteDescriptor => ({
  method: "GET",
  path: "/plugins/:pluginId",
  handler: () => ({ status: 200, json: { id: "plugin-1", name: "Mock Plugin" } }),
});
export const installPlugin = (): RouteDescriptor => ({
  method: "POST",
  path: "/plugins/install",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export const listCapabilities = (): RouteDescriptor => ({
  method: "GET",
  path: "/capabilities",
  handler: () => ({ status: 200, json: { items: [] } }),
});
