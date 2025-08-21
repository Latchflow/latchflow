import type { RouteDescriptor } from "../types.js";

export const listTriggers = (): RouteDescriptor => ({
  method: "GET",
  path: "/triggers",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const getTrigger = (): RouteDescriptor => ({
  method: "GET",
  path: "/triggers/:id",
  handler: () => ({ status: 200, json: { id: "trig-1" } }),
});
export const listActions = (): RouteDescriptor => ({
  method: "GET",
  path: "/actions",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const getAction = (): RouteDescriptor => ({
  method: "GET",
  path: "/actions/:id",
  handler: () => ({ status: 200, json: { id: "act-1" } }),
});
export const listPipelines = (): RouteDescriptor => ({
  method: "GET",
  path: "/pipelines",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const getPipeline = (): RouteDescriptor => ({
  method: "GET",
  path: "/pipelines/:id",
  handler: () => ({ status: 200, json: { id: "pipe-1" } }),
});
