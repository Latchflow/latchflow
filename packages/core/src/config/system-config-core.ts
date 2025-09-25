import { z } from "zod";
import type { DbClient } from "../db/db.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";
import { appendChangeLog } from "../history/changelog.js";
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

type HistoryConfig = {
  HISTORY_SNAPSHOT_INTERVAL: number;
  HISTORY_MAX_CHAIN_DEPTH: number;
};

type ServiceOptions = {
  masterKey?: Buffer;
  history?: HistoryConfig;
  systemUserId?: string;
};

export class SystemConfigService {
  protected validator: SystemConfigValidator;
  protected masterKey?: Buffer;
  protected historyCfg?: HistoryConfig;
  protected systemUserId: string;

  constructor(
    protected db: DbClient,
    opts: ServiceOptions = {},
  ) {
    this.masterKey = opts.masterKey;
    this.historyCfg = opts.history;
    this.systemUserId = opts.systemUserId ?? "system";
    this.validator = new SystemConfigValidator();
  }

  private getEnvValue(key: string): string | undefined {
    return process.env[key];
  }

  private getMappingForKey(key: string) {
    return (ALL_CONFIG_MAPPING as Record<string, { category?: string; isSecret?: boolean }>)[key];
  }

  protected badRequest(message: string, code: string): Error & { status: number; code: string } {
    const error = new Error(message) as Error & { status: number; code: string };
    error.status = 400;
    error.code = code;
    return error;
  }

  private requireMasterKey(action: "encrypt" | "decrypt", key: string): Buffer {
    if (!this.masterKey) {
      const verb = action === "encrypt" ? "encrypting" : "decrypting";
      throw this.badRequest(
        `Master key required for ${verb} secret values (key ${key})`,
        "MASTER_KEY_REQUIRED",
      );
    }
    return this.masterKey;
  }

  async get(key: string): Promise<SystemConfigValue | null> {
    const config = await this.db.systemConfig.findUnique({
      where: { key, isActive: true },
    });

    if (config) {
      let rawValue: unknown;

      if (config.isSecret && config.encrypted) {
        const masterKey = this.requireMasterKey("decrypt", key);
        try {
          rawValue = decryptValue(config.encrypted, masterKey);
        } catch (error) {
          throw this.badRequest(
            `Failed to decrypt secret value for key ${key}: ${(error as Error).message}`,
            "DECRYPT_FAILED",
          );
        }
      } else {
        rawValue = config.value;
      }

      return this.toSystemConfigValue(config, rawValue);
    }

    const envValue = this.getEnvValue(key);
    if (envValue !== undefined) {
      const mapping = this.getMappingForKey(key) ?? {};
      return {
        key,
        value: envValue,
        category: mapping.category ?? null,
        schema: null,
        metadata: { source: "environment" },
        isSecret: Boolean(mapping.isSecret),
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
      if (config.isSecret && config.encrypted) {
        const masterKey = this.requireMasterKey("decrypt", config.key);
        try {
          const decrypted = decryptValue(config.encrypted, masterKey);
          return this.toSystemConfigValue(config, decrypted);
        } catch (error) {
          throw this.badRequest(
            `Failed to decrypt secret value for key ${config.key}: ${(error as Error).message}`,
            "DECRYPT_FAILED",
          );
        }
      }

      return this.toSystemConfigValue(config, config.value);
    });
  }

  async set(
    key: string,
    value: unknown,
    options: SystemConfigOptions = {},
  ): Promise<SystemConfigValue> {
    if (value === undefined) {
      throw this.badRequest("Value is required", "VALUE_REQUIRED");
    }

    await this.ensureValuePassesSchema(key, value, options.schema);

    const actorUserId = options.userId ?? this.systemUserId;

    const result = await this.db.$transaction(async (tx) =>
      this.upsertConfig(tx, key, value, options, actorUserId),
    );

    return this.toSystemConfigValue(result.record, result.rawValue);
  }

  async delete(key: string, userId?: string): Promise<boolean> {
    const actorUserId = userId ?? this.systemUserId;

    return this.db.$transaction(async (tx) => {
      const existing = await tx.systemConfig.findUnique({ where: { key } });
      if (!existing) {
        return false;
      }

      const updated = await tx.systemConfig.update({
        where: { key },
        data: {
          isActive: false,
          updatedBy: userId,
        },
      });

      await this.appendAudit(tx, updated.id, actorUserId);
      return true;
    });
  }

  async seedFromEnvironment(
    envVars: Record<string, { category?: string; isSecret?: boolean }>,
    userId?: string,
  ): Promise<void> {
    for (const [envKey, mapping] of Object.entries(envVars)) {
      const envValue = this.getEnvValue(envKey);
      if (envValue === undefined) continue;

      const existing = await this.db.systemConfig.findUnique({ where: { key: envKey } });
      if (existing) continue;

      await this.set(envKey, envValue, {
        category: mapping.category ?? "environment",
        isSecret: Boolean(mapping.isSecret),
        userId,
        metadata: { source: "environment_seed" },
      });
    }
  }

  async validateSchema(
    key: string,
    value: unknown,
    schemaOverride?: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const existing = await this.db.systemConfig.findUnique({
      where: { key },
      select: { schema: true },
    });
    const schemaToUse = schemaOverride ?? existing?.schema ?? null;
    return this.validator.validateWithSchema(schemaToUse, value);
  }

  protected async upsertConfig(
    tx: DbClient | Prisma.TransactionClient,
    key: string,
    value: unknown,
    options: SystemConfigOptions,
    actorUserId: string,
  ): Promise<{ record: Prisma.SystemConfig; rawValue: unknown }> {
    const existing = await tx.systemConfig.findUnique({ where: { key } });
    const targetIsSecret = options.isSecret ?? existing?.isSecret ?? false;

    const { encrypted, jsonValue } = this.prepareStoredValues(value, targetIsSecret, key);

    const record = await tx.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: jsonValue,
        encrypted,
        category: options.category,
        schema: options.schema as Prisma.InputJsonValue,
        metadata: options.metadata as Prisma.InputJsonValue,
        isSecret: targetIsSecret,
        createdBy: actorUserId,
      },
      update: {
        value: jsonValue,
        encrypted,
        category: options.category,
        schema: options.schema as Prisma.InputJsonValue,
        metadata: options.metadata as Prisma.InputJsonValue,
        isSecret: targetIsSecret,
        updatedBy: actorUserId,
      },
    });

    await this.appendAudit(tx, record.id, actorUserId);

    return { record, rawValue: value };
  }

  protected prepareStoredValues(
    value: unknown,
    isSecret: boolean,
    key: string,
  ): { encrypted?: string; jsonValue?: Prisma.InputJsonValue } {
    if (isSecret) {
      if (typeof value !== "string") {
        throw this.badRequest("Secret values must be strings", "INVALID_SECRET_VALUE");
      }
      const masterKey = this.requireMasterKey("encrypt", key);
      return {
        encrypted: encryptValue(value, masterKey),
      };
    }

    return {
      jsonValue: value as Prisma.InputJsonValue,
    };
  }

  protected async appendAudit(
    tx: DbClient | Prisma.TransactionClient,
    configId: string,
    actorUserId: string,
  ): Promise<void> {
    if (!this.historyCfg) {
      return;
    }

    await appendChangeLog(tx, this.historyCfg, "SYSTEM_CONFIG", configId, {
      actorType: "USER",
      actorUserId,
    });
  }

  protected toSystemConfigValue(config: Prisma.SystemConfig, rawValue: unknown): SystemConfigValue {
    return {
      key: config.key,
      value: config.isSecret ? rawValue : (config.value as unknown),
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

  private async ensureValuePassesSchema(
    key: string,
    value: unknown,
    schemaOverride?: unknown,
  ): Promise<void> {
    const validation = await this.validateSchema(key, value, schemaOverride);
    if (!validation.valid) {
      const details = validation.errors?.join(", ") ?? "Unknown validation error";
      throw this.badRequest(`Validation failed: ${details}`, "VALIDATION_FAILED");
    }
  }
}
