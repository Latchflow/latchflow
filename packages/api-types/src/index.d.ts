/**
 * Public entry point for `@latchflow/api-types`.
 *
 * - `src/generated.d.ts` is produced by `openapi-typescript` and contains the
 *   real OpenAPI-derived definitions. It is ignored by version control.
 * - This file re-exports the generated surface and also provides lightweight
 *   fallbacks so TypeScript projects can type-check even before the generator
 *   runs.
 */

export type { paths, components, operations, external } from "./generated";

// Fallback definitions used when the generated file has not been produced yet.
// openapi-typescript overwrites `src/generated.d.ts` with concrete types that
// satisfy this module declaration via augmentation.
declare module "./generated" {
  export type paths = Record<string, unknown>;
  export type components = Record<string, unknown>;
  export type operations = Record<string, unknown>;
  export type external = Record<string, unknown>;
}
