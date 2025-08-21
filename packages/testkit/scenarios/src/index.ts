import { makeBundle, makeFile, makeRecipient } from "@latchflow/testkit-fixtures";
import type { FileItem } from "@latchflow/testkit-api-types";
import { AuthGates } from "@latchflow/testkit-utils";
import { InMemoryStore, type DBSeed } from "./store.js";

export interface ScenarioHandlers {
  // Internal, transport-agnostic handler descriptors
  routes: RouteDescriptor[];
}

export type HandlerFn = (ctx: {
  store: InMemoryStore;
  req: { url: URL; method: string; headers: Record<string, string | string[]>; body?: unknown };
  auth: AuthGates;
}) => { status: number; json?: unknown; body?: unknown; headers?: Record<string, string> };

export interface RouteDescriptor {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string; // absolute path starting with '/'
  handler: HandlerFn;
}

export interface ScenarioResult {
  dbSeed: DBSeed;
  store: InMemoryStore;
  handlers: ScenarioHandlers;
  controls: {
    auth: AuthGates;
    reset: () => void;
  };
}

export function emptyWorkspace(): ScenarioResult {
  const dbSeed: DBSeed = { files: [], bundles: [], recipients: [], bundleObjects: [] };
  const store = new InMemoryStore(dbSeed);
  const auth = new AuthGates();
  const routes: RouteDescriptor[] = [
    whoami(auth),
    listFiles(auth, store),
    listBundles(auth, store),
    listRecipients(auth, store),
  ];
  return {
    dbSeed,
    store,
    handlers: { routes },
    controls: { auth, reset: () => store.reset(dbSeed) },
  };
}

export function singleBundleHappyPath(): ScenarioResult {
  const fileA = makeFile({ name: "a.txt", size: 10 });
  const fileB = makeFile({ name: "b.txt", size: 20 });
  const bundle = makeBundle({ name: "Bundle 1" });
  const recipient = makeRecipient({ email: "recip@example.com" });
  const dbSeed: DBSeed = {
    files: [fileA, fileB],
    bundles: [bundle],
    recipients: [recipient],
    bundleObjects: [
      { id: `${bundle.id}-${fileA.id}`, bundleId: bundle.id, fileId: fileA.id },
      { id: `${bundle.id}-${fileB.id}`, bundleId: bundle.id, fileId: fileB.id },
    ],
  };
  const store = new InMemoryStore(dbSeed);
  const auth = new AuthGates();
  const routes: RouteDescriptor[] = [
    whoami(auth),
    listFiles(auth, store),
    listBundles(auth, store),
    listRecipients(auth, store),
    listBundleObjects(auth, store),
  ];
  return {
    dbSeed,
    store,
    handlers: { routes },
    controls: { auth, reset: () => store.reset(dbSeed) },
  };
}

// Route helpers
function whoami(auth: AuthGates): RouteDescriptor {
  return {
    method: "GET",
    path: "/whoami",
    handler: () => {
      // keep simple: always an admin identity when allowed
      try {
        auth.require("admin");
      } catch (e: unknown) {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      return { status: 200, json: { identity: { role: "admin", name: "Test Admin" } } };
    },
  };
}

function listFiles(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/files",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch (_e: unknown) {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const url = req.url;
      const items = Array.from(store.files.values());
      // Simple, non-cursor paging for now
      const limit = Number(url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

function listBundles(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/bundles",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch (_e: unknown) {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const url = req.url;
      const items = Array.from(store.bundles.values());
      const limit = Number(url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

function listRecipients(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/recipients",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch (_e: unknown) {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const url = req.url;
      const items = Array.from(store.recipients.values());
      const limit = Number(url.searchParams.get("limit") || "50");
      return { status: 200, json: { items: items.slice(0, limit) } };
    },
  };
}

function listBundleObjects(auth: AuthGates, store: InMemoryStore): RouteDescriptor {
  return {
    method: "GET",
    path: "/bundles/:bundleId/objects",
    handler: ({ req }) => {
      try {
        auth.require("admin");
      } catch (_e: unknown) {
        return {
          status: 401,
          json: { error: { code: "UNAUTHORIZED", message: "Login required" } },
        };
      }
      const parts = req.url.pathname.split("/");
      const bundleId = parts[2];
      const objects = Array.from(store.bundleObjects.values()).filter(
        (o) => o.bundleId === bundleId,
      );
      const files = objects.map((o) => store.files.get(o.fileId)).filter(Boolean) as FileItem[];
      return { status: 200, json: { items: files } };
    },
  };
}

export const scenarios = { emptyWorkspace, singleBundleHappyPath };
