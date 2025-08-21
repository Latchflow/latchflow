import { AuthGates } from "@latchflow/testkit-utils";
import type { FileItem } from "@latchflow/testkit-api-types";
import type { InMemoryStore } from "../store.js";
import type { RouteDescriptor } from "../types.js";

export function listFiles(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/files",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const items = Array.from(store.files.values());
      const limit = Number(req.url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

export function uploadFile(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "POST",
    path: "/files/upload",
    handler: () => {
      try {
        auth.require("admin");
      } catch {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const id = `id-${Math.random().toString(36).slice(2, 10)}`;
      const file: FileItem = {
        id,
        name: "uploaded.bin",
        size: 1,
        contentType: "application/octet-stream",
        createdAt: new Date().toISOString(),
      };
      store.files.set(id, file);
      return { status: 201, json: file };
    },
  };
}

export const uploadUrl = (_auth: AuthGates): RouteDescriptor => ({
  method: "POST",
  path: "/files/upload-url",
  handler: () => ({ status: 200, json: { url: "https://uploads.local/presigned", fields: {} } }),
});

export function getFile(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/files/:id",
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
      const f = store.files.get(id);
      if (!f) return { status: 404, json: { error: { code: "NOT_FOUND", message: "Not found" } } };
      return { status: 200, json: f };
    },
  };
}

export function deleteFile(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "DELETE",
    path: "/files/:id",
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
      store.files.delete(id);
      return { status: 204 };
    },
  };
}

export const moveFile = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "POST",
  path: "/files/:id/move",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export const updateFileMetadata = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "POST",
  path: "/files/:id/metadata",
  handler: () => ({ status: 200, json: { ok: true } }),
});
export const batchDeleteFiles = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "POST",
  path: "/files/batch/delete",
  handler: () => ({ status: 200, json: { deleted: 0 } }),
});
export const batchMoveFiles = (_auth: AuthGates, _store: InMemoryStore): RouteDescriptor => ({
  method: "POST",
  path: "/files/batch/move",
  handler: () => ({ status: 200, json: { moved: 0 } }),
});
export const downloadFile = (_auth: AuthGates): RouteDescriptor => ({
  method: "GET",
  path: "/files/:id/download",
  handler: () => ({
    status: 200,
    body: new TextEncoder().encode("mock-data"),
    headers: { "content-type": "application/octet-stream" },
  }),
});
