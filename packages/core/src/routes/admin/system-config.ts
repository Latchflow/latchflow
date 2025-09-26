import { z } from "zod";
import type { HttpServer, ResponseLike } from "../../http/http-server.js";
import { getSystemConfigService } from "../../config/system-config-startup.js";
import { getDb } from "../../db/db.js";
import type { AppConfig } from "../../config/env-config.js";
import type { BulkConfigInput, SystemConfigValue } from "../../config/types.js";
import { SystemConfigValidator } from "../../config/system-config-validator.js";
import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { SystemConfigBulkService } from "../../config/system-config-bulk.js";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";

const BulkConfigInputSchema = z.object({
  key: z.string().min(1),
  value: z.unknown(),
  category: z.string().optional(),
  schema: z.unknown().optional(),
  metadata: z.unknown().optional(),
  isSecret: z.boolean().optional(),
});

const BulkUpdateSchema = z.object({
  configs: z.array(BulkConfigInputSchema).min(1).max(50), // Limit bulk operations
});

const GetConfigQuerySchema = z.object({
  keys: z.string().optional(), // Comma-separated keys
  category: z.string().optional(),
  includeSecrets: z.coerce.boolean().optional(),
  offset: z.coerce.number().min(0).optional(),
  limit: z.coerce.number().min(1).max(100).optional(),
});

const IndividualConfigSchema = z.object({
  value: z.unknown(),
  category: z.string().optional(),
  schema: z.unknown().optional(),
  metadata: z.unknown().optional(),
  isSecret: z.boolean().optional(),
});

const TestConfigSchema = z.object({
  category: z.string(),
  configs: z.array(BulkConfigInputSchema).min(1),
});

const IndividualGetQuerySchema = z.object({
  includeSecret: z.coerce.boolean().optional(),
});

const maskConfigValue = (value: SystemConfigValue, includeSecret: boolean): SystemConfigValue => {
  if (!value.isSecret || includeSecret) {
    return value;
  }
  return {
    ...value,
    value: "[REDACTED]",
  };
};

const respondWithError = (res: ResponseLike, error: unknown) => {
  const err = error as Error & { status?: number; code?: string };
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  const code = err.code ?? (status >= 500 ? "INTERNAL_ERROR" : "BAD_REQUEST");
  res.status(status).json({
    status: "error",
    code,
    message: err.message ?? "Unexpected error",
  });
};

const parseKeysParam = (keys?: string) =>
  keys
    ?.split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);

export function registerSystemConfigAdminRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();
  const servicePromise = getSystemConfigService(db, config);

  // GET /system/config - Bulk read with filtering
  server.get(
    "/system/config",
    requireAdminOrApiToken({
      policySignature: "GET /system/config" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_READ],
    })(async (req, res) => {
      const query = GetConfigQuerySchema.safeParse(req.query);
      if (!query.success) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid query parameters",
          errors: query.error.errors,
        });
        return;
      }

      const { keys, category, includeSecrets = false, offset = 0, limit = 100 } = query.data;

      try {
        const systemConfigService = await servicePromise;
        const configs = await systemConfigService.getFiltered({
          keys: parseKeysParam(keys),
          category,
          includeSecrets,
          offset,
          limit,
        });
        const sanitized = configs.map((configValue) =>
          maskConfigValue(configValue, includeSecrets),
        );
        res.status(200).json({
          status: "success",
          data: {
            configs: sanitized,
            pagination: {
              offset,
              limit,
              total: sanitized.length,
            },
          },
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );

  // PUT /system/config - Bulk transactional update
  server.put(
    "/system/config",
    requireAdminOrApiToken({
      policySignature: "PUT /system/config" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_WRITE],
    })(async (req, res) => {
      const body = BulkUpdateSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
        return;
      }

      const userId = req.user?.id;

      try {
        const systemConfigService = await servicePromise;
        const result = await systemConfigService.setBulk(
          body.data.configs as BulkConfigInput[],
          userId,
        );

        if (result.errors.length > 0) {
          res.status(400).json({
            status: "error",
            code: "BULK_UPDATE_FAILED",
            message: "Some configurations failed to update",
            data: {
              errors: result.errors,
              success: result.success.map((configValue) => maskConfigValue(configValue, false)),
            },
          });
          return;
        }

        const updated = result.success.map((configValue) => maskConfigValue(configValue, false));
        res.status(200).json({
          status: "success",
          data: {
            updated,
            count: updated.length,
          },
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );

  // GET /system/config/:key - Individual read (convenience wrapper)
  server.get(
    "/system/config/:key",
    requireAdminOrApiToken({
      policySignature: "GET /system/config/:key" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_READ],
    })(async (req, res) => {
      const key = req.params.key as string | undefined;
      if (!key) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
        return;
      }

      const includeSecretResult = IndividualGetQuerySchema.safeParse(req.query ?? {});
      const includeSecret = includeSecretResult.success
        ? Boolean(includeSecretResult.data.includeSecret)
        : false;

      try {
        const systemConfigService = await servicePromise;
        const configValue = await systemConfigService.get(key);

        if (!configValue) {
          res.status(404).json({
            status: "error",
            code: "NOT_FOUND",
            message: `Configuration key '${key}' not found`,
          });
          return;
        }

        res.status(200).json({
          status: "success",
          data: maskConfigValue(configValue, includeSecret),
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );

  // PUT /system/config/:key - Individual update (convenience wrapper)
  server.put(
    "/system/config/:key",
    requireAdminOrApiToken({
      policySignature: "PUT /system/config/:key" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_WRITE],
    })(async (req, res) => {
      const key = req.params.key as string | undefined;
      if (!key) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
        return;
      }

      const body = IndividualConfigSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
        return;
      }

      const userId = req.user?.id;

      try {
        const systemConfigService = await servicePromise;
        const result = await systemConfigService.set(key, body.data.value, {
          category: body.data.category,
          schema: body.data.schema,
          metadata: body.data.metadata,
          isSecret: body.data.isSecret,
          userId,
        });

        res.status(200).json({
          status: "success",
          data: maskConfigValue(result, false),
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );

  // DELETE /system/config/:key - Individual delete (convenience wrapper)
  server.delete(
    "/system/config/:key",
    requireAdminOrApiToken({
      policySignature: "DELETE /system/config/:key" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_WRITE],
    })(async (req, res) => {
      const key = req.params.key as string | undefined;
      if (!key) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
        return;
      }

      const userId = req.user?.id;

      try {
        const systemConfigService = await servicePromise;
        const deleted = await systemConfigService.delete(key, userId);

        if (!deleted) {
          res.status(404).json({
            status: "error",
            code: "NOT_FOUND",
            message: `Configuration key '${key}' not found`,
          });
          return;
        }

        res.status(200).json({
          status: "success",
          message: `Configuration '${key}' deleted successfully`,
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );

  // POST /system/config/test - Test configuration without saving
  server.post(
    "/system/config/test",
    requireAdminOrApiToken({
      policySignature: "POST /system/config/test" as RouteSignature,
      scopes: [SCOPES.SYSTEM_CONFIG_WRITE],
    })(async (req, res) => {
      const body = TestConfigSchema.safeParse(req.body);
      if (!body.success) {
        res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
        return;
      }

      const { category, configs } = body.data;

      try {
        const systemConfigService = await servicePromise;
        const overrides = new Map<string, unknown>();
        for (const config of configs) {
          overrides.set(config.key, config.value);
        }

        const results = await Promise.all(
          configs.map(async (configItem) => {
            try {
              const validation = await systemConfigService.validateSchema(
                configItem.key,
                configItem.value,
                configItem.schema,
              );

              if (!validation.valid) {
                return {
                  key: configItem.key,
                  valid: false,
                  errors: validation.errors,
                };
              }

              if (category === "email") {
                const emailValidation = validateEmailConfigurationValue(configItem);
                if (!emailValidation.valid) {
                  return {
                    key: configItem.key,
                    valid: false,
                    errors: emailValidation.errors,
                  };
                }
              }

              return {
                key: configItem.key,
                valid: true,
              };
            } catch (error) {
              return {
                key: configItem.key,
                valid: false,
                errors: [(error as Error).message],
              };
            }
          }),
        );

        let emailConnectivity: { key: string; valid: boolean; errors?: string[] } | null = null;
        if (category === "email") {
          const smtpUrlResult = results.find((item) => item.key === "SMTP_URL");
          if (!smtpUrlResult || !smtpUrlResult.valid) {
            emailConnectivity = {
              key: "SMTP_CONNECTION",
              valid: false,
              errors: ["SMTP_URL must be valid before testing connectivity"],
            };
          } else {
            emailConnectivity = {
              key: "SMTP_CONNECTION",
              ...(await testEmailConnectivity(systemConfigService, overrides)),
            };
          }
        }

        const finalResults = emailConnectivity ? [...results, emailConnectivity] : results;
        const allValid = finalResults.every((result) => result.valid);

        res.status(200).json({
          status: "success",
          data: {
            category,
            valid: allValid,
            results: finalResults,
          },
        });
      } catch (error) {
        respondWithError(res, error);
      }
    }),
  );
}

function validateEmailConfigurationValue(config: BulkConfigInput): {
  key: string;
  valid: boolean;
  errors?: string[];
} {
  return {
    key: config.key,
    ...SystemConfigValidator.validateEmailConfiguration(config.key, config.value),
  };
}

async function testEmailConnectivity(
  service: SystemConfigBulkService,
  overrides: Map<string, unknown>,
): Promise<{ valid: boolean; errors?: string[] }> {
  const smtpUrlValue = await resolveEffectiveConfigValue(service, overrides, "SMTP_URL");

  if (typeof smtpUrlValue !== "string" || smtpUrlValue.trim().length === 0) {
    return {
      valid: false,
      errors: ["SMTP_URL is required to test email connectivity"],
    };
  }

  try {
    await verifySmtpConnection(smtpUrlValue);
    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      errors: [(error as Error).message],
    };
  }
}

async function resolveEffectiveConfigValue(
  service: SystemConfigBulkService,
  overrides: Map<string, unknown>,
  key: string,
): Promise<unknown> {
  if (overrides.has(key)) {
    return overrides.get(key);
  }
  const existing = await service.get(key);
  return existing?.value;
}

async function verifySmtpConnection(smtpUrl: string): Promise<void> {
  let transporter: nodemailer.Transporter<SMTPTransport.SentMessageInfo> | null = null;
  try {
    const options = buildTransportOptions(smtpUrl);
    transporter = nodemailer.createTransport(options);
    await transporter.verify();
  } catch (error) {
    throw new Error(
      `Failed to verify SMTP connection: ${(error as Error).message ?? String(error)}`,
    );
  } finally {
    transporter?.close();
  }
}

function buildTransportOptions(smtpUrl: string): SMTPTransport.Options {
  const url = new URL(smtpUrl);
  const secure = url.protocol === "smtps:";
  const port = url.port ? Number(url.port) : secure ? 465 : 587;
  const ignoreTLS = url.searchParams.get("ignoreTLS") === "true";
  const rejectUnauthorizedParam = url.searchParams.get("rejectUnauthorized");
  const tlsOptions =
    rejectUnauthorizedParam !== null
      ? { rejectUnauthorized: rejectUnauthorizedParam !== "false" }
      : undefined;

  const username = url.username ? decodeURIComponent(url.username) : undefined;
  const password = url.password ? decodeURIComponent(url.password) : undefined;

  const auth = username || password ? { user: username ?? "", pass: password ?? "" } : undefined;

  return {
    host: url.hostname,
    port,
    secure,
    auth,
    ignoreTLS,
    connectionTimeout: 5_000,
    greetingTimeout: 5_000,
    socketTimeout: 5_000,
    ...(tlsOptions ? { tls: tlsOptions } : {}),
  } satisfies SMTPTransport.Options;
}
