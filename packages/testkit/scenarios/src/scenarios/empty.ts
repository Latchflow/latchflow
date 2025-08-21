import { AuthGates } from "@latchflow/testkit-utils";
import { InMemoryStore, type DBSeed } from "../store.js";
import type { ScenarioResult } from "../types.js";
import { assembleAllRoutes } from "../all-routes.js";

export function emptyWorkspace(): ScenarioResult {
  const dbSeed: DBSeed = { files: [], bundles: [], recipients: [], bundleObjects: [] };
  const store = new InMemoryStore(dbSeed);
  const auth = new AuthGates();
  const routes = assembleAllRoutes(auth, store);
  return {
    dbSeed,
    store,
    handlers: { routes },
    controls: { auth, reset: () => store.reset(dbSeed) },
  };
}
