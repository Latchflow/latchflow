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
});

export type AppConfig = z.infer<typeof EnvSchema> & {
  PORT: number;
  QUEUE_CONFIG_JSON?: unknown | null;
  STORAGE_CONFIG_JSON?: unknown | null;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(", ");
    throw new Error(`Invalid environment: ${msg}`);
  }
  const cfg = parsed.data as AppConfig;
  cfg.PORT = (cfg.PORT as unknown as number) || 3001;
  return cfg;
}
