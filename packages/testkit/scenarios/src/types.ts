import { AuthGates } from "@latchflow/testkit-utils";
import type { InMemoryStore } from "./store.js";

export type HandlerFn = (ctx: {
  store: InMemoryStore;
  req: { url: URL; method: string; headers: Record<string, string | string[]>; body?: unknown };
  auth: AuthGates;
}) => { status: number; json?: unknown; body?: unknown; headers?: Record<string, string> };

export interface RouteDescriptor {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  handler: HandlerFn;
}

export interface ScenarioHandlers {
  routes: RouteDescriptor[];
}

export interface ScenarioResult {
  dbSeed: import("./store.js").DBSeed;
  store: InMemoryStore;
  handlers: ScenarioHandlers;
  controls: { auth: AuthGates; reset: () => void };
}
