import { z } from "zod";
import type { DbClient } from "../db/db.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";
import type { Prisma } from "@latchflow/db";

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

export type SystemConfigValue = {
  key: string;
  value: unknown;
  category?: string | null;
  schema?: unknown | null;
  metadata?: unknown | null;
  isSecret: boolean;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy?: string | null;
  updatedBy?: string | null;
};

export class SystemConfigService {
  constructor(
    private db: DbClient,
    private masterKey?: Buffer,
  ) {}

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
    options: {
      category?: string;
      schema?: unknown;
      metadata?: unknown;
      isSecret?: boolean;
      userId?: string;
    } = {},
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
    if (!config?.schema) {
      return { valid: true };
    }

    try {
      // Basic validation for common types
      const schema = config.schema as Record<string, unknown>;

      if (schema.type) {
        const valueType = typeof value;

        if (schema.type === "string" && valueType !== "string") {
          return { valid: false, errors: [`Expected string, got ${valueType}`] };
        }

        if (schema.type === "number" && valueType !== "number") {
          return { valid: false, errors: [`Expected number, got ${valueType}`] };
        }

        if (schema.type === "boolean" && valueType !== "boolean") {
          return { valid: false, errors: [`Expected boolean, got ${valueType}`] };
        }

        if (
          schema.type === "object" &&
          (valueType !== "object" || value === null || Array.isArray(value))
        ) {
          return { valid: false, errors: [`Expected object, got ${valueType}`] };
        }

        if (schema.type === "array" && !Array.isArray(value)) {
          return { valid: false, errors: [`Expected array, got ${valueType}`] };
        }
      }

      // String validation
      if (schema.type === "string" && typeof value === "string") {
        if (schema.minLength && value.length < schema.minLength) {
          return {
            valid: false,
            errors: [`String too short, minimum length is ${schema.minLength}`],
          };
        }

        if (schema.maxLength && value.length > schema.maxLength) {
          return {
            valid: false,
            errors: [`String too long, maximum length is ${schema.maxLength}`],
          };
        }

        if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
          return { valid: false, errors: [`String does not match pattern: ${schema.pattern}`] };
        }
      }

      // Number validation
      if (schema.type === "number" && typeof value === "number") {
        if (schema.minimum && value < schema.minimum) {
          return { valid: false, errors: [`Number too small, minimum is ${schema.minimum}`] };
        }

        if (schema.maximum && value > schema.maximum) {
          return { valid: false, errors: [`Number too large, maximum is ${schema.maximum}`] };
        }
      }

      // Enum validation
      if (schema.enum && !schema.enum.includes(value)) {
        return { valid: false, errors: [`Value must be one of: ${schema.enum.join(", ")}`] };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [(error as Error).message],
      };
    }
  }
}
