import { AuthGates } from "@latchflow/testkit-utils";
import { makeRecipient } from "@latchflow/testkit-fixtures";
import type { InMemoryStore } from "../store.js";
import type { RouteDescriptor } from "../types.js";

export function listRecipients(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/recipients",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const items = Array.from(store.recipients.values());
      const limit = Number(req.url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

export function createRecipient(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "POST",
    path: "/recipients",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const r = makeRecipient({ email: (req.body as { email?: string } | undefined)?.email });
      store.recipients.set(r.id, r);
      return { status: 201, json: r };
    },
  };
}

export function getRecipient(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/recipients/:recipientId",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const id = req.url.pathname.split("/")[2];
      const r = store.recipients.get(id);
      if (!r) return { status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } };
      return { status: 200, json: r };
    },
  };
}

export const updateRecipient = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "PUT",
  path: "/recipients/:recipientId",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export function deleteRecipient(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "DELETE",
    path: "/recipients/:recipientId",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const id = req.url.pathname.split("/")[2];
      store.recipients.delete(id);
      return { status: 204 };
    },
  };
}

export const listBundleRecipients = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "GET",
  path: "/bundles/:bundleId/recipients",
  handler: () => ({ status: 200, json: { items: [] } }),
});
export const batchAttachBundleRecipients = (
  _auth: AuthGates,
  _store: InMemoryStore,
): RouteDescriptor => ({
  method: "POST",
  path: "/bundles/:bundleId/recipients/batch",
  handler: () => ({ status: 200, json: { attached: 0 } }),
});
