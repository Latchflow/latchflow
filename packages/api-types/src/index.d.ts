/**
 * Public type surface for `@latchflow/api-types`.
 *
 * The full set of OpenAPI-derived types is generated at build time and lives in
 * `dist/index.d.ts`. Keeping this source stub small avoids committing multi‑MB
 * artifacts to version control while still giving downstream packages stable
 * type names to import.
 *
 * During local development run `pnpm --filter @latchflow/api-types build` (or
 * the workspace root build script) to regenerate the concrete definitions. The
 * generated file augments the placeholder namespace below via declaration
 * merging.
 */

export type paths = LatchflowApiTypes.Generated["paths"];
export type components = LatchflowApiTypes.Generated["components"];
export type operations = LatchflowApiTypes.Generated["operations"];
export type external = LatchflowApiTypes.Generated["external"];

/**
 * Placeholder definitions that keep the package type-checkable even when the
 * generated declarations have not been produced yet. The build pipeline emits
 * a declaration file that merges with this namespace and replaces the loose
 * `Record<string, unknown>` fallback with the real OpenAPI schema.
 */
declare namespace LatchflowApiTypes {
  interface Generated {
    paths: Record<string, unknown>;
    components: Record<string, unknown>;
    operations: Record<string, unknown>;
    external: Record<string, unknown>;
  }
}
