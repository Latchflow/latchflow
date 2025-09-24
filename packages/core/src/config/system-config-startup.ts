import { SystemConfigService } from "./system-config.js";
import { logger } from "../observability/logger.js";
import type { AppConfig } from "../config/config.js";
import { PrismaClient } from "@latchflow/db";

const EMAIL_CONFIG_MAPPING = {
  SMTP_URL: { category: "email", isSecret: true },
  SMTP_FROM: { category: "email", isSecret: false },
} as const;

const CORE_CONFIG_MAPPING = {
  PORT: { category: "core", isSecret: false },
  PLUGINS_PATH: { category: "core", isSecret: false },
  LOG_LEVEL: { category: "core", isSecret: false },
  LOG_PRETTY: { category: "core", isSecret: false },
} as const;

const AUTH_CONFIG_MAPPING = {
  AUTH_SESSION_TTL_HOURS: { category: "auth", isSecret: false },
  RECIPIENT_SESSION_TTL_HOURS: { category: "auth", isSecret: false },
  ADMIN_MAGICLINK_TTL_MIN: { category: "auth", isSecret: false },
  RECIPIENT_OTP_TTL_MIN: { category: "auth", isSecret: false },
  RECIPIENT_OTP_LENGTH: { category: "auth", isSecret: false },
  AUTH_COOKIE_SECURE: { category: "auth", isSecret: false },
  ADMIN_UI_ORIGIN: { category: "auth", isSecret: false },
  ALLOW_DEV_AUTH: { category: "auth", isSecret: false },
} as const;

const STORAGE_CONFIG_MAPPING = {
  STORAGE_DRIVER: { category: "storage", isSecret: false },
  STORAGE_BASE_PATH: { category: "storage", isSecret: false },
  STORAGE_BUCKET: { category: "storage", isSecret: false },
  STORAGE_KEY_PREFIX: { category: "storage", isSecret: false },
  STORAGE_CONFIG_JSON: { category: "storage", isSecret: true },
} as const;

const QUEUE_CONFIG_MAPPING = {
  QUEUE_DRIVER: { category: "queue", isSecret: false },
  QUEUE_CONFIG_JSON: { category: "queue", isSecret: true },
} as const;

const ENCRYPTION_CONFIG_MAPPING = {
  ENCRYPTION_MODE: { category: "encryption", isSecret: false },
  ENCRYPTION_MASTER_KEY_B64: { category: "encryption", isSecret: true },
} as const;

const ALL_CONFIG_MAPPING = {
  ...EMAIL_CONFIG_MAPPING,
  ...CORE_CONFIG_MAPPING,
  ...AUTH_CONFIG_MAPPING,
  ...STORAGE_CONFIG_MAPPING,
  ...QUEUE_CONFIG_MAPPING,
  ...ENCRYPTION_CONFIG_MAPPING,
} as const;

export async function seedSystemConfigFromEnvironment(
  configService: SystemConfigService,
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
): Promise<SystemConfigService> {
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

  return new SystemConfigService(db, masterKey);
}
