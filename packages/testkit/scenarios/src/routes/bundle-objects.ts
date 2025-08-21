import { AuthGates } from "@latchflow/testkit-utils";
import type { FileItem } from "@latchflow/testkit-api-types";
import type { InMemoryStore } from "../store.js";
import type { RouteDescriptor } from "../types.js";

export function listBundleObjects(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/bundles/:bundleId/objects",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const bundleId = req.url.pathname.split("/")[2];
      const objects = Array.from(store.bundleObjects.values()).filter(
        (o) => o.bundleId === bundleId,
      );
      const files = objects.map((o) => store.files.get(o.fileId)).filter(Boolean) as FileItem[];
      return { status: 200, json: { items: files } };
    },
  };
}

export function attachBundleObjects(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "POST",
    path: "/bundles/:bundleId/objects",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const bundleId = req.url.pathname.split("/")[2];
      const files = Array.isArray((req.body as { fileIds?: string[] } | undefined)?.fileIds)
        ? ((req.body as { fileIds?: string[] }).fileIds as string[])
        : [];
      for (const fid of files) {
        const id = `${bundleId}-${fid}`;
        store.bundleObjects.set(id, { id, bundleId, fileId: fid });
      }
      return { status: 200, json: { attached: files.length } };
    },
  };
}

export function deleteBundleObject(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "DELETE",
    path: "/bundles/:bundleId/objects/:id",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const id = req.url.pathname.split("/")[4];
      store.bundleObjects.delete(id);
      return { status: 204 };
    },
  };
}
