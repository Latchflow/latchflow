import type { RouteDescriptor } from "../types.js";

export const recipientAuthStart = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/recipient/start",
  handler: () => ({ status: 200, json: { channel: "email", status: "sent" } }),
});
export const recipientAuthVerify = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/recipient/verify",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export const recipientAuthLogout = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/recipient/logout",
  handler: () => ({ status: 204 }),
});
