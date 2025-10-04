import { createHash } from "node:crypto";
import type { ProviderDescriptor, PluginLogger } from "./contracts.js";
import type { SystemConfigService } from "../config/system-config-core.js";

function slugify(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function buildConfigKey(pluginName: string, providerId: string): string {
  const pluginSlug = slugify(pluginName || "plugin");
  const providerSlug = slugify(providerId || "provider");
  return `PLUGIN_${pluginSlug}_PROVIDER_${providerSlug}`;
}

export async function ensureProviderConfig<TConfig>(options: {
  descriptor: ProviderDescriptor<TConfig>;
  systemConfig: SystemConfigService;
  pluginName: string;
  logger: PluginLogger;
}): Promise<TConfig> {
  const { descriptor, systemConfig, pluginName, logger } = options;
  const key = buildConfigKey(pluginName, descriptor.id);
  const existing = await systemConfig.get(key);
  const schema = descriptor.configSchema;

  if (!existing) {
    const seed = descriptor.defaults ?? {};
    const validation = await systemConfig.validateSchema(key, seed, schema);
    if (!validation.valid) {
      logger.warn(
        { key, errors: validation.errors ?? [] },
        "Provider configuration missing or invalid; populate SystemConfig to enable provider",
      );
      throw new Error(
        `Configuration required for provider ${descriptor.id} (SystemConfig key ${key}). Errors: ${
          validation.errors?.join(", ") ?? "missing required values"
        }`,
      );
    }

    await systemConfig.set(key, seed, {
      schema,
      isSecret: true,
      category: `provider:${descriptor.kind}`,
      metadata: {
        plugin: pluginName,
        providerId: descriptor.id,
        hash: createHash("sha256").update(key).digest("hex"),
      },
    });
    return seed as TConfig;
  }

  const validation = await systemConfig.validateSchema(key, existing.value, schema);
  if (!validation.valid) {
    logger.warn(
      { key, errors: validation.errors ?? [] },
      "Provider configuration does not satisfy schema",
    );
    throw new Error(
      `Configuration for provider ${descriptor.id} is invalid (SystemConfig key ${key}). Errors: ${
        validation.errors?.join(", ") ?? "validation failed"
      }`,
    );
  }

  return existing.value as TConfig;
}
