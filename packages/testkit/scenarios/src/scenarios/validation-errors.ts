import type { ScenarioResult, RouteDescriptor } from "../types.js";
import { singleBundleHappyPath } from "./single-bundle.js";

export function validationErrors(): ScenarioResult {
  const base = singleBundleHappyPath();
  const invalid = base.handlers.routes.map((rd) => {
    if (rd.method === "POST" || rd.method === "PUT") {
      return {
        ...rd,
        handler: () => ({
          status: 422,
          json: { error: { code: "VALIDATION_ERROR", message: "Invalid input" } },
        }),
      } as RouteDescriptor;
    }
    return rd;
  });
  return { ...base, handlers: { routes: invalid } };
}
