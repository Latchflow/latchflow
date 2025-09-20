import type { Permission } from "./types.js";
import { compilePermissions, computeRulesHash, type CompiledPermissions } from "./compile.js";

const compiledCache = new Map<string, CompiledPermissions>();

export function getOrCompilePermissions(
  permissions: Permission[] | null | undefined,
  existingHash?: string | null,
): CompiledPermissions {
  const safePermissions = Array.isArray(permissions) ? permissions : [];
  const desiredHash = existingHash && existingHash.length > 0 ? existingHash : computeRulesHash(safePermissions);
  const cached = compiledCache.get(desiredHash);
  if (cached) {
    return cached;
  }
  const compiled = compilePermissions(safePermissions, desiredHash);
  compiledCache.set(compiled.rulesHash, compiled);
  if (compiled.rulesHash !== desiredHash) {
    // Ensure both hashes point to the compiled data to avoid recompute loops until caller updates DB hash.
    compiledCache.set(desiredHash, compiled);
  }
  return compiled;
}

export function invalidateCompiledPermissions(rulesHash: string) {
  const entries = Array.from(compiledCache.entries());
  for (const [key, value] of entries) {
    if (key === rulesHash || value.rulesHash === rulesHash) {
      compiledCache.delete(key);
    }
  }
}

export function clearCompiledPermissionsCache() {
  compiledCache.clear();
}

export function getCompiledCacheSize() {
  return compiledCache.size;
}
