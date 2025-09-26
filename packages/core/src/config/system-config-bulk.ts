import type { Prisma } from "@latchflow/db";
import { decryptValue } from "../crypto/encryption.js";
import { SystemConfigService } from "./system-config-core.js";
import type {
  BulkConfigInput,
  BulkConfigResult,
  SystemConfigValue,
  FilterOptions,
} from "./types.js";

type PreparedBulkConfig = {
  key: string;
  value: unknown;
  category?: string;
  schema?: unknown;
  metadata?: unknown;
  requestedIsSecret?: boolean;
  targetIsSecret: boolean;
};

export class SystemConfigBulkService extends SystemConfigService {
  async setBulk(configs: BulkConfigInput[], userId?: string): Promise<BulkConfigResult> {
    const success: SystemConfigValue[] = [];
    const errors: Array<{ key: string; error: string }> = [];
    const actorUserId = userId ?? this.systemUserId;
    const prepared: PreparedBulkConfig[] = [];

    for (const config of configs) {
      if (config.value === undefined) {
        errors.push({ key: config.key, error: "Value is required" });
        continue;
      }

      const existing = await this.db.systemConfig.findUnique({ where: { key: config.key } });
      const targetIsSecret = config.isSecret ?? existing?.isSecret ?? false;
      const schema = config.schema ?? this.getDefaultSchema(config.key);

      const validation = await this.validateSchema(config.key, config.value, schema);
      if (!validation.valid) {
        errors.push({
          key: config.key,
          error: `Validation failed: ${validation.errors?.join(", ")}`,
        });
        continue;
      }

      if (targetIsSecret && !this.masterKey) {
        errors.push({
          key: config.key,
          error: "Master key required for encrypting secret values",
        });
        continue;
      }

      if (targetIsSecret && typeof config.value !== "string") {
        errors.push({
          key: config.key,
          error: "Secret values must be strings",
        });
        continue;
      }

      prepared.push({
        key: config.key,
        value: config.value,
        category: config.category,
        schema,
        metadata: config.metadata,
        requestedIsSecret: config.isSecret,
        targetIsSecret,
      });
    }

    if (errors.length > 0) {
      return { success: [], errors };
    }

    await this.db.$transaction(async (tx) => {
      for (const config of prepared) {
        const result = await this.upsertConfig(
          tx,
          config.key,
          config.value,
          {
            category: config.category,
            schema: config.schema ?? this.getDefaultSchema(config.key),
            metadata: config.metadata,
            isSecret: config.requestedIsSecret,
            userId,
          },
          actorUserId,
        );
        success.push(
          this.toSystemConfigValue(
            result.record,
            config.targetIsSecret ? config.value : result.record.value,
          ),
        );
      }
    });

    return { success, errors: [] };
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
      if (config.isSecret) {
        if (!includeSecrets) {
          const base = this.toSystemConfigValue(config, config.value);
          return { ...base, value: "[REDACTED]" };
        }

        if (config.encrypted) {
          if (!this.masterKey) {
            throw this.badRequest(
              "Master key required for decrypting secret values",
              "MASTER_KEY_REQUIRED",
            );
          }
          try {
            const decrypted = decryptValue(config.encrypted, this.masterKey);
            return this.toSystemConfigValue(config, decrypted);
          } catch (error) {
            throw this.badRequest(
              `Failed to decrypt secret value for key ${config.key}: ${(error as Error).message}`,
              "DECRYPT_FAILED",
            );
          }
        }
      }

      return this.toSystemConfigValue(config, config.value);
    });
  }
}
