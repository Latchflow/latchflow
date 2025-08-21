import type { ScenarioResult, RouteDescriptor } from "../types.js";
import { singleBundleHappyPath } from "./single-bundle.js";

export function rateLimited(): ScenarioResult {
  const base = singleBundleHappyPath();
  const limited = base.handlers.routes.map((rd) => {
    if (rd.path.startsWith("/files") || rd.path.startsWith("/bundles")) {
      return {
        ...rd,
        handler: () => ({
          status: 429,
          json: { error: { code: "RATE_LIMITED", message: "Too many requests" } },
          headers: { "retry-after": "1" },
        }),
      } as RouteDescriptor;
    }
    return rd;
  });
  return { ...base, handlers: { routes: limited } };
}
