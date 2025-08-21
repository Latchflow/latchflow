import type { RouteDescriptor } from "../types.js";

export const listUsers = (): RouteDescriptor => ({
  method: "GET",
  path: "/users",
  handler: () => ({
    status: 200,
    json: { items: [{ id: "admin-1", email: "admin@example.com" }] },
  }),
});
export const setUserRoles = (): RouteDescriptor => ({
  method: "POST",
  path: "/users/:id/roles",
  handler: () => ({ status: 200, json: { ok: true } }),
});
