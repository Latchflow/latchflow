export const E = {
  UNAUTHORIZED: { code: "UNAUTHORIZED", message: "Login required" },
  FORBIDDEN: { code: "FORBIDDEN", message: "Not allowed" },
  NOT_FOUND: { code: "NOT_FOUND", message: "Not found" },
  RATE_LIMITED: { code: "RATE_LIMITED", message: "Too many requests" },
  VALIDATION: { code: "VALIDATION_ERROR", message: "Invalid input" },
} as const;

export function errorEnvelope<T extends keyof typeof E>(key: T, requestId?: string) {
  return { error: { ...E[key], requestId } };
}
