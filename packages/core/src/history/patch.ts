export type JsonPatchOp = { op: "replace" | "add" | "remove"; path: string; value?: unknown };

export function computePatch(prev: unknown, next: unknown): JsonPatchOp[] {
  // Minimal implementation: if deep-equal, no ops; else replace root.
  if (canonical(prev) === canonical(next)) return [];
  return [{ op: "replace", path: "/", value: next }];
}

export function applyPatch(state: unknown, patch: JsonPatchOp[]): unknown {
  // Minimal implementation supports only root replace.
  const rootReplace = patch.find((p) => p.op === "replace" && p.path === "/");
  if (rootReplace) return rootReplace.value;
  return state;
}

function canonical(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return "";
  }
}
