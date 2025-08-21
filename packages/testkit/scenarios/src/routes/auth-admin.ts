import { AuthGates } from "@latchflow/testkit-utils";
import type { RouteDescriptor } from "../types.js";

export function whoami(auth: AuthGates): RouteDescriptor {
  return {
    method: "GET",
    path: "/whoami",
    handler: () => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      return { status: 200, json: { identity: { role: "admin", name: "Test Admin" } } };
    },
  };
}

export function authMe(auth: AuthGates): RouteDescriptor {
  return {
    method: "GET",
    path: "/auth/me",
    handler: () => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      return {
        status: 200,
        json: { user: { id: "admin-1", email: "admin@example.com", roles: ["admin"] } },
      };
    },
  };
}

export const adminAuthStart = (): RouteDescriptor => ({
  method: "GET",
  path: "/auth/admin/start",
  handler: () => ({ status: 200, json: { url: "https://auth/start" } }),
});
export const adminAuthCallback = (): RouteDescriptor => ({
  method: "GET",
  path: "/auth/admin/callback",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export const adminAuthLogout = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/admin/logout",
  handler: () => ({ status: 204 }),
});
export const authSessions = (): RouteDescriptor => ({
  method: "GET",
  path: "/auth/sessions",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const authSessionsRevoke = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/sessions/revoke",
  handler: () => ({ status: 204 }),
});
