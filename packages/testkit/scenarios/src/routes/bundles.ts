import { AuthGates } from "@latchflow/testkit-utils";
import { makeBundle } from "@latchflow/testkit-fixtures";
import type { InMemoryStore } from "../store.js";
import type { RouteDescriptor } from "../types.js";

export function listBundles(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/bundles",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const items = Array.from(store.bundles.values());
      const limit = Number(req.url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

export function createBundle(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "POST",
    path: "/bundles",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const body = (req.body as { name?: string; description?: string }) || {};
      const b = makeBundle({ name: body.name || "New Bundle", description: body.description });
      store.bundles.set(b.id, b);
      return { status: 201, json: b };
    },
  };
}

export function getBundle(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/bundles/:bundleId",
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
      const b = store.bundles.get(id);
      if (!b) return { status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } };
      return { status: 200, json: b };
    },
  };
}

export const updateBundle = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "PUT",
  path: "/bundles/:bundleId",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export function deleteBundle(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "DELETE",
    path: "/bundles/:bundleId",
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
      store.bundles.delete(id);
      return { status: 204 };
    },
  };
}
