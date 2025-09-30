export type PluginServiceErrorKind =
  | "VALIDATION"
  | "NOT_FOUND"
  | "PERMISSION"
  | "RATE_LIMIT"
  | "RETRYABLE"
  | "FATAL";

export interface PluginServiceErrorOptions {
  kind: PluginServiceErrorKind;
  code: string;
  message?: string;
  retryDelayMs?: number;
  reason?: string;
  status?: number;
  details?: unknown;
}

export class PluginServiceError extends Error {
  readonly kind: PluginServiceErrorKind;
  readonly code: string;
  readonly retryDelayMs?: number;
  readonly reason?: string;
  readonly status?: number;
  readonly details?: unknown;

  constructor(opts: PluginServiceErrorOptions) {
    super(opts.message ?? opts.code);
    this.name = "PluginServiceError";
    this.kind = opts.kind;
    this.code = opts.code;
    this.retryDelayMs = opts.retryDelayMs;
    this.reason = opts.reason;
    this.status = opts.status;
    this.details = opts.details;
  }

  static validation(code: string, message?: string, details?: unknown) {
    return new PluginServiceError({ kind: "VALIDATION", code, message, details, status: 400 });
  }

  static permission(code: string, message?: string, details?: unknown) {
    return new PluginServiceError({ kind: "PERMISSION", code, message, details, status: 403 });
  }

  static notFound(code: string, message?: string, details?: unknown) {
    return new PluginServiceError({ kind: "NOT_FOUND", code, message, details, status: 404 });
  }

  static retryable(code: string, reason?: string, retryDelayMs?: number, details?: unknown) {
    return new PluginServiceError({
      kind: "RETRYABLE",
      code,
      reason,
      retryDelayMs,
      details,
      status: 503,
    });
  }

  static fatal(code: string, message?: string, details?: unknown) {
    return new PluginServiceError({ kind: "FATAL", code, message, details, status: 500 });
  }

  static rateLimit(code: string, retryDelayMs?: number, details?: unknown) {
    return new PluginServiceError({
      kind: "RATE_LIMIT",
      code,
      retryDelayMs,
      details,
      status: 429,
    });
  }
}
