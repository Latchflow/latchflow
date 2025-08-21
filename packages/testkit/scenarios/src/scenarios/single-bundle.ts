import { makeBundle, makeFile, makeRecipient } from "@latchflow/testkit-fixtures";
import { AuthGates } from "@latchflow/testkit-utils";
import { InMemoryStore, type DBSeed } from "../store.js";
import type { ScenarioResult } from "../types.js";
import { assembleAllRoutes } from "../all-routes.js";

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
  const routes = assembleAllRoutes(auth, store);
  return {
    dbSeed,
    store,
    handlers: { routes },
    controls: { auth, reset: () => store.reset(dbSeed) },
  };
}
