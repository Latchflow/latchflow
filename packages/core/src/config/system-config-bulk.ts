import type { Prisma } from "@latchflow/db";
import { encryptValue, decryptValue } from "../crypto/encryption.js";
import { SystemConfigService } from "./system-config-core.js";
import type {
  BulkConfigInput,
  BulkConfigResult,
  SystemConfigValue,
  FilterOptions,
} from "./types.js";

export class SystemConfigBulkService extends SystemConfigService {
  async setBulk(configs: BulkConfigInput[], userId?: string): Promise<BulkConfigResult> {
    const success: SystemConfigValue[] = [];
    const errors: Array<{ key: string; error: string }> = [];

    // Use a transaction for atomic bulk updates
    await this.db.$transaction(async (tx) => {
      for (const config of configs) {
        try {
          // Skip if no value provided
          if (config.value === undefined) {
            errors.push({
              key: config.key,
              error: "Value is required",
            });
            continue;
          }

          // Validate the config first
          const validation = await this.validateSchema(config.key, config.value);
          if (!validation.valid) {
            errors.push({
              key: config.key,
              error: `Validation failed: ${validation.errors?.join(", ")}`,
            });
            continue;
          }

          const { category, schema, metadata, isSecret = false } = config;

          let encrypted: string | undefined;
          let jsonValue: Prisma.InputJsonValue | undefined;

          if (isSecret) {
            if (!this.masterKey) {
              errors.push({
                key: config.key,
                error: "Master key required for encrypting secret values",
              });
              continue;
            }
            if (typeof config.value !== "string") {
              errors.push({
                key: config.key,
                error: "Secret values must be strings",
              });
              continue;
            }
            encrypted = encryptValue(config.value, this.masterKey);
          } else {
            jsonValue = config.value as Prisma.InputJsonValue;
          }

          const result = await tx.systemConfig.upsert({
            where: { key: config.key },
            create: {
              key: config.key,
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

          success.push({
            key: result.key,
            value: isSecret ? config.value : result.value,
            category: result.category,
            schema: result.schema,
            metadata: result.metadata,
            isSecret: result.isSecret,
            isActive: result.isActive,
            createdAt: result.createdAt,
            updatedAt: result.updatedAt,
            createdBy: result.createdBy,
            updatedBy: result.updatedBy,
          });
        } catch (error) {
          errors.push({
            key: config.key,
            error: (error as Error).message,
          });
        }
      }

      // If any errors occurred, throw to rollback the transaction
      if (errors.length > 0) {
        throw new Error(`Bulk update failed for keys: ${errors.map((e) => e.key).join(", ")}`);
      }
    });

    return { success, errors };
  }

  async getFiltered(options: FilterOptions = {}): Promise<SystemConfigValue[]> {
    const { keys, category, includeSecrets = false, offset = 0, limit = 100 } = options;

    const where: Prisma.SystemConfigWhereInput = {
      isActive: true,
      ...(keys && { key: { in: keys } }),
      ...(category && { category }),
    };

    const configs = await this.db.systemConfig.findMany({
      where,
      orderBy: [{ category: "asc" }, { key: "asc" }],
      skip: offset,
      take: limit,
    });

    return configs.map((config) => {
      let value: unknown;

      if (config.isSecret) {
        if (!includeSecrets) {
          value = "[REDACTED]";
        } else if (config.encrypted) {
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
}
