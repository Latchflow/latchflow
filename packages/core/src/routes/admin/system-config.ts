import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { requireAdmin } from "../../middleware/require-admin.js";
import { getSystemConfigService } from "../../config/system-config-startup.js";
import { getDb } from "../../db/db.js";
import type { AppConfig } from "../../config/env-config.js";
import type { BulkConfigInput } from "../../config/types.js";
import { SystemConfigValidator } from "../../config/system-config-validator.js";

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

export function registerSystemConfigAdminRoutes(server: HttpServer, config: AppConfig) {
  const db = getDb();

  // GET /system/config - Bulk read with filtering
  server.get("/system/config", async (req, res) => {
    try {
      await requireAdmin(req);
      const query = GetConfigQuerySchema.safeParse(req.query);

      if (!query.success) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid query parameters",
          errors: query.error.errors,
        });
      }

      const { keys, category, includeSecrets = false, offset = 0, limit = 100 } = query.data;

      const systemConfigService = await getSystemConfigService(db, config);

      const configs = await systemConfigService.getFiltered({
        keys: keys ? keys.split(",").map((k) => k.trim()) : undefined,
        category,
        includeSecrets,
        offset,
        limit,
      });

      return res.status(200).json({
        status: "success",
        data: {
          configs,
          pagination: {
            offset,
            limit,
            total: configs.length,
          },
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });

  // PUT /system/config - Bulk transactional update
  server.put("/system/config", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const body = BulkUpdateSchema.safeParse(req.body);

      if (!body.success) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
      }

      const systemConfigService = await getSystemConfigService(db, config);

      const result = await systemConfigService.setBulk(
        body.data.configs as BulkConfigInput[],
        user.id,
      );

      if (result.errors.length > 0) {
        return res.status(400).json({
          status: "error",
          code: "BULK_UPDATE_FAILED",
          message: "Some configurations failed to update",
          data: result,
        });
      }

      return res.status(200).json({
        status: "success",
        data: {
          updated: result.success,
          count: result.success.length,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });

  // GET /system/config/:key - Individual read (convenience wrapper)
  server.get("/system/config/:key", async (req, res) => {
    try {
      await requireAdmin(req);
      const key = req.params.key as string;

      if (!key) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
      }

      const systemConfigService = await getSystemConfigService(db, config);
      const configValue = await systemConfigService.get(key);

      if (!configValue) {
        return res.status(404).json({
          status: "error",
          code: "NOT_FOUND",
          message: `Configuration key '${key}' not found`,
        });
      }

      // Don't expose secret values in individual reads unless explicitly requested
      if (configValue.isSecret && req.query.includeSecret !== "true") {
        configValue.value = "[REDACTED]";
      }

      return res.status(200).json({
        status: "success",
        data: configValue,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });

  // PUT /system/config/:key - Individual update (convenience wrapper)
  server.put("/system/config/:key", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const key = req.params.key as string;

      if (!key) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
      }

      const body = IndividualConfigSchema.safeParse(req.body);

      if (!body.success) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
      }

      const systemConfigService = await getSystemConfigService(db, config);

      const result = await systemConfigService.set(key, body.data.value, {
        category: body.data.category,
        schema: body.data.schema,
        metadata: body.data.metadata,
        isSecret: body.data.isSecret,
        userId: user.id,
      });

      return res.status(200).json({
        status: "success",
        data: result,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });

  // DELETE /system/config/:key - Individual delete (convenience wrapper)
  server.delete("/system/config/:key", async (req, res) => {
    try {
      const { user } = await requireAdmin(req);
      const key = req.params.key as string;

      if (!key) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Missing configuration key",
        });
      }

      const systemConfigService = await getSystemConfigService(db, config);
      const deleted = await systemConfigService.delete(key, user.id);

      if (!deleted) {
        return res.status(404).json({
          status: "error",
          code: "NOT_FOUND",
          message: `Configuration key '${key}' not found`,
        });
      }

      return res.status(200).json({
        status: "success",
        message: `Configuration '${key}' deleted successfully`,
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });

  // POST /system/config/test - Test configuration without saving
  server.post("/system/config/test", async (req, res) => {
    try {
      await requireAdmin(req);
      const body = TestConfigSchema.safeParse(req.body);

      if (!body.success) {
        return res.status(400).json({
          status: "error",
          code: "BAD_REQUEST",
          message: "Invalid request body",
          errors: body.error.errors,
        });
      }

      const { category, configs } = body.data;
      const systemConfigService = await getSystemConfigService(db, config);

      // Test configuration-specific validation
      const results = await Promise.all(
        configs.map(async (config) => {
          try {
            // Validate schema
            const validation = await systemConfigService.validateSchema(config.key, config.value);

            if (!validation.valid) {
              return {
                key: config.key,
                valid: false,
                errors: validation.errors,
              };
            }

            // Category-specific testing
            if (category === "email") {
              return await testEmailConfiguration(config);
            }

            return {
              key: config.key,
              valid: true,
            };
          } catch (error) {
            return {
              key: config.key,
              valid: false,
              errors: [(error as Error).message],
            };
          }
        }),
      );

      const allValid = results.every((r) => r.valid);

      return res.status(200).json({
        status: "success",
        data: {
          category,
          valid: allValid,
          results,
        },
      });
    } catch (error) {
      return res.status(500).json({
        status: "error",
        code: "INTERNAL_ERROR",
        message: (error as Error).message,
      });
    }
  });
}

// Helper function for testing email configurations
async function testEmailConfiguration(config: BulkConfigInput): Promise<{
  key: string;
  valid: boolean;
  errors?: string[];
}> {
  const result = SystemConfigValidator.validateEmailConfiguration(config.key, config.value);
  return {
    key: config.key,
    ...result,
  };
}
