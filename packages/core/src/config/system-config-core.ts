import { z } from "zod";
import type { DbClient } from "../db/db.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";
import type { Prisma } from "@latchflow/db";
import type { SystemConfigValue, SystemConfigOptions } from "./types.js";
import { SystemConfigValidator } from "./system-config-validator.js";

export const SystemConfigSchema = z.object({
  key: z.string().min(1),
  value: z.unknown().optional(),
  encrypted: z.string().optional(),
  category: z.string().optional(),
  schema: z.unknown().optional(),
  metadata: z.unknown().optional(),
  isSecret: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export type SystemConfigInput = z.infer<typeof SystemConfigSchema>;

// Environment variable mappings
export const EMAIL_CONFIG_MAPPING = {
  SMTP_URL: { category: "email", isSecret: true },
  SMTP_FROM: { category: "email", isSecret: false },
} as const;

export const CORE_CONFIG_MAPPING = {
  PORT: { category: "core", isSecret: false },
  PLUGINS_PATH: { category: "core", isSecret: false },
  LOG_LEVEL: { category: "core", isSecret: false },
  LOG_PRETTY: { category: "core", isSecret: false },
} as const;

export const AUTH_CONFIG_MAPPING = {
  AUTH_SESSION_TTL_HOURS: { category: "auth", isSecret: false },
  RECIPIENT_SESSION_TTL_HOURS: { category: "auth", isSecret: false },
  ADMIN_MAGICLINK_TTL_MIN: { category: "auth", isSecret: false },
  RECIPIENT_OTP_TTL_MIN: { category: "auth", isSecret: false },
  RECIPIENT_OTP_LENGTH: { category: "auth", isSecret: false },
  AUTH_COOKIE_SECURE: { category: "auth", isSecret: false },
  ADMIN_UI_ORIGIN: { category: "auth", isSecret: false },
  ALLOW_DEV_AUTH: { category: "auth", isSecret: false },
} as const;

export const STORAGE_CONFIG_MAPPING = {
  STORAGE_DRIVER: { category: "storage", isSecret: false },
  STORAGE_BASE_PATH: { category: "storage", isSecret: false },
  STORAGE_BUCKET: { category: "storage", isSecret: false },
  STORAGE_KEY_PREFIX: { category: "storage", isSecret: false },
  STORAGE_CONFIG_JSON: { category: "storage", isSecret: true },
} as const;

export const QUEUE_CONFIG_MAPPING = {
  QUEUE_DRIVER: { category: "queue", isSecret: false },
  QUEUE_CONFIG_JSON: { category: "queue", isSecret: true },
} as const;

export const ENCRYPTION_CONFIG_MAPPING = {
  ENCRYPTION_MODE: { category: "encryption", isSecret: false },
  ENCRYPTION_MASTER_KEY_B64: { category: "encryption", isSecret: true },
} as const;

export const ALL_CONFIG_MAPPING = {
  ...EMAIL_CONFIG_MAPPING,
  ...CORE_CONFIG_MAPPING,
  ...AUTH_CONFIG_MAPPING,
  ...STORAGE_CONFIG_MAPPING,
  ...QUEUE_CONFIG_MAPPING,
  ...ENCRYPTION_CONFIG_MAPPING,
} as const;

export class SystemConfigService {
  protected validator: SystemConfigValidator;

  constructor(
    protected db: DbClient,
    protected masterKey?: Buffer,
  ) {
    this.validator = new SystemConfigValidator();
  }

  private getEnvValue(key: string): string | undefined {
    return process.env[key];
  }

  async get(key: string): Promise<SystemConfigValue | null> {
    // First check database
    const config = await this.db.systemConfig.findUnique({
      where: { key, isActive: true },
    });

    if (config) {
      let value: unknown;

      if (config.isSecret && config.encrypted) {
        if (!this.masterKey) {
          throw new Error("Master key required for decrypting secret values");
        }
        try {
          value = decryptValue(config.encrypted, this.masterKey);
        } catch (error) {
          throw new Error(
            `Failed to decrypt secret value for key ${key}: ${(error as Error).message}`,
          );
        }
      } else {
        value = config.value;
      }

      return {
        key: config.key,
        value,
        category: config.category,
        schema: config.schema,
        metadata: config.metadata,
        isSecret: config.isSecret,
        isActive: config.isActive,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        createdBy: config.createdBy,
        updatedBy: config.updatedBy,
      };
    }

    // Fallback to environment variable
    const envValue = this.getEnvValue(key);
    if (envValue !== undefined) {
      return {
        key,
        value: envValue,
        category: null,
        schema: null,
        metadata: { source: "environment" },
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      };
    }

    return null;
  }

  async getAll(category?: string): Promise<SystemConfigValue[]> {
    const where: Prisma.SystemConfigWhereInput = {
      isActive: true,
      ...(category && { category }),
    };

    const configs = await this.db.systemConfig.findMany({
      where,
      orderBy: [{ category: "asc" }, { key: "asc" }],
    });

    return configs.map((config) => {
      let value: unknown;

      if (config.isSecret && config.encrypted) {
        if (!this.masterKey) {
          throw new Error("Master key required for decrypting secret values");
        }
        try {
          value = decryptValue(config.encrypted, this.masterKey);
        } catch (error) {
          throw new Error(
            `Failed to decrypt secret value for key ${config.key}: ${(error as Error).message}`,
          );
        }
      } else {
        value = config.value;
      }

      return {
        key: config.key,
        value,
        category: config.category,
        schema: config.schema,
        metadata: config.metadata,
        isSecret: config.isSecret,
        isActive: config.isActive,
        createdAt: config.createdAt,
        updatedAt: config.updatedAt,
        createdBy: config.createdBy,
        updatedBy: config.updatedBy,
      };
    });
  }

  async set(
    key: string,
    value: unknown,
    options: SystemConfigOptions = {},
  ): Promise<SystemConfigValue> {
    const { category, schema, metadata, isSecret = false, userId } = options;

    let encrypted: string | undefined;
    let jsonValue: Prisma.InputJsonValue | undefined;

    if (isSecret) {
      if (!this.masterKey) {
        throw new Error("Master key required for encrypting secret values");
      }
      if (typeof value !== "string") {
        throw new Error("Secret values must be strings");
      }
      encrypted = encryptValue(value, this.masterKey);
    } else {
      jsonValue = value as Prisma.InputJsonValue;
    }

    const config = await this.db.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: jsonValue,
        encrypted,
        category,
        schema: schema as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
        isSecret,
        createdBy: userId,
      },
      update: {
        value: jsonValue,
        encrypted,
        category,
        schema: schema as Prisma.InputJsonValue,
        metadata: metadata as Prisma.InputJsonValue,
        isSecret,
        updatedBy: userId,
      },
    });

    return {
      key: config.key,
      value: isSecret ? value : config.value,
      category: config.category,
      schema: config.schema,
      metadata: config.metadata,
      isSecret: config.isSecret,
      isActive: config.isActive,
      createdAt: config.createdAt,
      updatedAt: config.updatedAt,
      createdBy: config.createdBy,
      updatedBy: config.updatedBy,
    };
  }

  async delete(key: string, userId?: string): Promise<boolean> {
    const result = await this.db.systemConfig.updateMany({
      where: { key },
      data: {
        isActive: false,
        updatedBy: userId,
      },
    });

    return result.count > 0;
  }

  async seedFromEnvironment(
    envVars: Record<string, { category?: string; isSecret?: boolean }>,
    userId?: string,
  ): Promise<void> {
    for (const [envKey, config] of Object.entries(envVars)) {
      const envValue = this.getEnvValue(envKey);
      if (envValue === undefined) continue;

      // Only seed if not already in database
      const existing = await this.db.systemConfig.findUnique({
        where: { key: envKey },
      });

      if (!existing) {
        await this.set(envKey, envValue, {
          category: config.category || "environment",
          isSecret: config.isSecret || false,
          userId,
          metadata: { source: "environment_seed" },
        });
      }
    }
  }

  async validateSchema(
    key: string,
    value: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const config = await this.get(key);
    return this.validator.validateSchema(config, value);
  }
}
