import { SystemConfigBulkService } from "./system-config-bulk.js";
import { ALL_CONFIG_MAPPING } from "./system-config-core.js";
import { logger } from "../observability/logger.js";
import type { AppConfig } from "../config/env-config.js";
import { PrismaClient } from "@latchflow/db";

export async function seedSystemConfigFromEnvironment(
  configService: SystemConfigBulkService,
  config: AppConfig,
): Promise<void> {
  try {
    logger.info("Seeding system configuration from environment variables");

    await configService.seedFromEnvironment(ALL_CONFIG_MAPPING, config.SYSTEM_USER_ID);

    logger.info("System configuration seeding completed");
  } catch (error) {
    logger.warn(
      { error: (error as Error).message },
      "Failed to seed system configuration from environment variables",
    );
  }
}

export async function getSystemConfigService(
  db: PrismaClient,
  config: AppConfig,
): Promise<SystemConfigBulkService> {
  let masterKey: Buffer | undefined;

  if (config.ENCRYPTION_MODE === "aes-gcm" && config.ENCRYPTION_MASTER_KEY_B64) {
    try {
      masterKey = Buffer.from(config.ENCRYPTION_MASTER_KEY_B64, "base64");
    } catch (error) {
      logger.warn(
        { error: (error as Error).message },
        "Failed to decode encryption master key, secrets will not be available",
      );
    }
  }

  return new SystemConfigBulkService(db, {
    masterKey,
    history: {
      HISTORY_SNAPSHOT_INTERVAL: config.HISTORY_SNAPSHOT_INTERVAL,
      HISTORY_MAX_CHAIN_DEPTH: config.HISTORY_MAX_CHAIN_DEPTH,
    },
    systemUserId: config.SYSTEM_USER_ID ?? "system",
  });
}
