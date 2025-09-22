import { z } from "zod";

const EnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PORT: z
    .string()
    .transform((v) => (v ? Number(v) : 3001))
    .pipe(z.number().int().positive())
    .optional(),
  PLUGINS_PATH: z.string().default("packages/plugins"),

  QUEUE_DRIVER: z.string().default("memory"),
  QUEUE_DRIVER_PATH: z.string().optional(),
  QUEUE_CONFIG_JSON: z
    .string()
    .transform((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch (e) {
        throw new Error("Invalid QUEUE_CONFIG_JSON: " + (e as Error).message);
      }
    })
    .optional(),

  // Storage configuration
  STORAGE_DRIVER: z.string().default("fs"),
  STORAGE_DRIVER_PATH: z.string().optional(),
  STORAGE_CONFIG_JSON: z
    .string()
    .transform((v) => {
      if (!v) return null;
      try {
        return JSON.parse(v);
      } catch (e) {
        throw new Error("Invalid STORAGE_CONFIG_JSON: " + (e as Error).message);
      }
    })
    .optional(),
  STORAGE_BASE_PATH: z.string().default("./.data/storage"),
  STORAGE_BUCKET: z.string().optional(),
  STORAGE_KEY_PREFIX: z.string().default(""),

  ENCRYPTION_MODE: z.enum(["none", "aes-gcm"]).default("none"),
  ENCRYPTION_MASTER_KEY_B64: z.string().optional(),

  // Auth config
  AUTH_COOKIE_DOMAIN: z.string().optional(),
  AUTH_SESSION_TTL_HOURS: z
    .string()
    .default("12")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  RECIPIENT_SESSION_TTL_HOURS: z
    .string()
    .default("2")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  ADMIN_MAGICLINK_TTL_MIN: z
    .string()
    .default("15")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  RECIPIENT_OTP_TTL_MIN: z
    .string()
    .default("10")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  RECIPIENT_OTP_LENGTH: z
    .string()
    .default("6")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  AUTH_COOKIE_SECURE: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === "true")),
  ADMIN_UI_ORIGIN: z.string().optional(),
  ALLOW_DEV_AUTH: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v === "true")),

  // Email (optional; used for magic-link delivery in non-dev flows)
  SMTP_URL: z.string().optional(),
  SMTP_FROM: z.string().email().optional(),

  // CLI auth
  DEVICE_CODE_TTL_MIN: z
    .string()
    .default("10")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  DEVICE_CODE_INTERVAL_SEC: z
    .string()
    .default("5")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  API_TOKEN_TTL_DAYS: z
    .string()
    .optional()
    .transform((v) => (v && v.length ? Number(v) : undefined))
    .pipe(z.number().int().positive().optional()),
  API_TOKEN_SCOPES_DEFAULT: z
    .string()
    .default('["core:read","core:write"]')
    .transform((v) => {
      try {
        const arr = JSON.parse(v);
        if (!Array.isArray(arr)) throw new Error("not an array");
        return arr as string[];
      } catch (e) {
        throw new Error("Invalid API_TOKEN_SCOPES_DEFAULT JSON: " + (e as Error).message);
      }
    }),
  API_TOKEN_PREFIX: z.string().default("lfk_"),

  // History/audit knobs
  HISTORY_SNAPSHOT_INTERVAL: z
    .string()
    .default("20")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  HISTORY_MAX_CHAIN_DEPTH: z
    .string()
    .default("200")
    .transform((v) => Number(v))
    .pipe(z.number().int().positive()),
  SYSTEM_USER_ID: z.string().default("system"),

  AUTHZ_METRICS_ENABLED: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v === "true")),
  AUTHZ_METRICS_OTLP_URL: z.string().optional(),
  AUTHZ_METRICS_OTLP_HEADERS: z
    .string()
    .optional()
    .transform((v) => {
      if (!v) return undefined;
      try {
        const parsed = JSON.parse(v);
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, string>;
        }
        throw new Error("expected JSON object");
      } catch (e) {
        throw new Error("Invalid AUTHZ_METRICS_OTLP_HEADERS: " + (e as Error).message);
      }
    }),
  AUTHZ_METRICS_SERVICE_NAME: z.string().optional(),
  AUTHZ_METRICS_SERVICE_NAMESPACE: z.string().optional(),
  AUTHZ_METRICS_SERVICE_INSTANCE_ID: z.string().optional(),
  AUTHZ_METRICS_EXPORT_INTERVAL_MS: z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : Number(v)))
    .pipe(z.number().positive().optional()),
  AUTHZ_METRICS_EXPORT_TIMEOUT_MS: z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : Number(v)))
    .pipe(z.number().positive().optional()),
  AUTHZ_METRICS_ENABLE_DIAGNOSTICS: z
    .string()
    .optional()
    .transform((v) => (v == null ? undefined : v === "true")),
  AUTHZ_V2: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v === "true")),
  AUTHZ_V2_SHADOW: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v === "true")),
  AUTHZ_REQUIRE_ADMIN_2FA: z
    .string()
    .optional()
    .transform((v) => (v == null ? false : v === "true")),
  AUTHZ_REAUTH_WINDOW_MIN: z
    .string()
    .optional()
    .transform((v) => (v == null || v === "" ? undefined : Number(v)))
    .pipe(z.number().positive().optional()),
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  PORT: number;
  QUEUE_CONFIG_JSON?: unknown | null;
  STORAGE_CONFIG_JSON?: unknown | null;
  AUTH_COOKIE_SECURE: boolean;
  API_TOKEN_TTL_DAYS?: number;
  API_TOKEN_SCOPES_DEFAULT: string[];
  HISTORY_SNAPSHOT_INTERVAL: number;
  HISTORY_MAX_CHAIN_DEPTH: number;
  SYSTEM_USER_ID: string;
  ALLOW_DEV_AUTH: boolean;
  AUTHZ_METRICS_ENABLED: boolean;
  AUTHZ_METRICS_OTLP_HEADERS?: Record<string, string>;
  AUTHZ_METRICS_EXPORT_INTERVAL_MS?: number;
  AUTHZ_METRICS_EXPORT_TIMEOUT_MS?: number;
  AUTHZ_METRICS_ENABLE_DIAGNOSTICS?: boolean;
  AUTHZ_V2: boolean;
  AUTHZ_V2_SHADOW: boolean;
  AUTHZ_REQUIRE_ADMIN_2FA: boolean;
  AUTHZ_REAUTH_WINDOW_MIN?: number;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const cfg = parsed.data as AppConfig;
  cfg.PORT = (cfg.PORT as unknown as number) || 3001;
  // Default cookie secure flag: true unless NODE_ENV === 'development'
  if (typeof cfg.AUTH_COOKIE_SECURE !== "boolean") {
    cfg.AUTH_COOKIE_SECURE = process.env.NODE_ENV === "development" ? false : true;
  }
  cfg.AUTHZ_METRICS_ENABLED = Boolean(cfg.AUTHZ_METRICS_ENABLED);
  cfg.AUTHZ_V2 = Boolean(cfg.AUTHZ_V2);
  cfg.AUTHZ_V2_SHADOW = Boolean(cfg.AUTHZ_V2_SHADOW);
  cfg.AUTHZ_REQUIRE_ADMIN_2FA = Boolean(cfg.AUTHZ_REQUIRE_ADMIN_2FA);
  return cfg;
}

// Cookie name constants
export const ADMIN_SESSION_COOKIE = "lf_admin_sess" as const;
export const RECIPIENT_SESSION_COOKIE = "lf_recipient_sess" as const;
