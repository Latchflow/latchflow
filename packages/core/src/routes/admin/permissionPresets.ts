import { z } from "zod";
import type { HttpServer } from "../../http/http-server.js";
import { getDb } from "../../db/db.js";
import type { Prisma, ChangeKind } from "@latchflow/db";
import { requireAdminOrApiToken } from "../../middleware/require-admin-or-api-token.js";
import { SCOPES } from "../../auth/scopes.js";
import type { RouteSignature } from "../../authz/policy.js";
import type { AppConfig } from "../../config/config.js";
import { appendChangeLog, materializeVersion } from "../../history/changelog.js";
import type { Permission } from "../../authz/types.js";
import { computeRulesHash } from "../../authz/compile.js";
import { invalidateCompiledPermissions } from "../../authz/cache.js";
import { authorizeRequest } from "../../authz/authorize.js";
import { buildContext } from "../../authz/context.js";
import { POLICY } from "../../authz/policy.js";
import { recordAuthzSimulation } from "../../observability/metrics.js";

interface PermissionPresetDeps {
  config?: AppConfig;
}

type ChangeLogRow = {
  version: number;
  isSnapshot: boolean;
  hash: string;
  changeNote: string | null;
  changedPath: string | null;
  changeKind: ChangeKind | null;
  createdAt: Date;
  actorType: "USER" | "ACTION" | "SYSTEM";
  actorUserId: string | null;
  actorInvocationId: string | null;
  actorActionDefinitionId: string | null;
  onBehalfOfUserId: string | null;
};

export function registerPermissionPresetAdminRoutes(server: HttpServer, deps?: PermissionPresetDeps) {
  const db = getDb();
  const defaultHistoryCfg: Pick<
    AppConfig,
    "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH" | "SYSTEM_USER_ID"
  > = {
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    SYSTEM_USER_ID: "system",
  };
  const config = deps?.config ?? defaultHistoryCfg;
  const historyCfg: Pick<AppConfig, "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH"> = {
    HISTORY_SNAPSHOT_INTERVAL: config.HISTORY_SNAPSHOT_INTERVAL,
    HISTORY_MAX_CHAIN_DEPTH: config.HISTORY_MAX_CHAIN_DEPTH,
  };
  const systemUserId = config.SYSTEM_USER_ID ?? "system";

  const toPermissionPresetDto = (preset: {
    id: string;
    name: string;
    version: number;
    rules: unknown;
    createdAt: Date;
    updatedAt: Date;
    createdBy: string;
    updatedBy: string | null;
  }) => ({
    id: preset.id,
    name: preset.name,
    version: preset.version,
    rules: Array.isArray(preset.rules) ? preset.rules : [],
    rulesHash: Array.isArray(preset.rules) ? computeRulesHash(preset.rules as Permission[]) : "",
    createdAt: preset.createdAt.toISOString(),
    updatedAt: preset.updatedAt.toISOString(),
    createdBy: preset.createdBy,
    updatedBy: preset.updatedBy,
  });

  // GET /admin/permissions/presets — list presets
  server.get(
    "/admin/permissions/presets",
    requireAdminOrApiToken({
      policySignature: "GET /admin/permissions/presets" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_READ],
    })(async (req, res) => {
      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(200).optional(),
        cursor: z.string().optional(),
        q: z.string().optional(),
        updatedSince: z.coerce.date().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};
      const where: Prisma.PermissionPresetWhereInput = {};
      if (query.q) where.name = { contains: query.q, mode: "insensitive" };
      if (query.updatedSince) where.updatedAt = { gte: query.updatedSince };

      const take = query.limit ?? 50;
      const rows = await db.permissionPreset.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        take: take + 1,
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
      });

      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      res.json({
        items: items.map(toPermissionPresetDto),
        nextCursor,
        hasMore,
      });
    }),
  );

  // POST /admin/permissions/presets — create preset
  server.post(
    "/admin/permissions/presets",
    requireAdminOrApiToken({
      policySignature: "POST /admin/permissions/presets" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        name: z.string().min(1).max(255),
        rules: z.array(z.unknown()).default([]),
      });
      const body = Body.parse(req.body);
      const userId = req.user?.id ?? systemUserId;

      // Validate rules format
      const validRules = body.rules.filter((rule): rule is Permission => {
        return (
          typeof rule === "object" &&
          rule !== null &&
          typeof (rule as any).action === "string" &&
          typeof (rule as any).resource === "string"
        );
      });

      const preset = await db.permissionPreset.create({
        data: {
          name: body.name,
          rules: validRules,
          createdBy: userId,
        },
      });

      await appendChangeLog(
        db,
        "USER",
        preset.id,
        "PermissionPreset",
        {
          name: preset.name,
          rules: validRules,
        },
        historyCfg,
        {
          changeNote: `Created permission preset: ${preset.name}`,
          changeKind: "ADD_CHILD",
          changedPath: null,
          actorUserId: userId,
        },
      );

      res.status(201).json(toPermissionPresetDto(preset));
    }),
  );

  // GET /admin/permissions/presets/:id — get preset by ID
  server.get(
    "/admin/permissions/presets/:id",
    requireAdminOrApiToken({
      policySignature: "GET /admin/permissions/presets/:id" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_READ],
    })(async (req, res) => {
      const preset = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!preset) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      res.json(toPermissionPresetDto(preset));
    }),
  );

  // PATCH /admin/permissions/presets/:id — update preset
  server.patch(
    "/admin/permissions/presets/:id",
    requireAdminOrApiToken({
      policySignature: "PATCH /admin/permissions/presets/:id" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        name: z.string().min(1).max(255).optional(),
      });
      const body = Body.parse(req.body);
      const userId = req.user?.id ?? systemUserId;

      const existing = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      const updateData: Prisma.PermissionPresetUpdateInput = {
        updatedBy: userId,
      };

      if (body.name !== undefined) {
        updateData.name = body.name;
      }

      const preset = await db.permissionPreset.update({
        where: { id: req.params.id },
        data: updateData,
      });

      await appendChangeLog(
        db,
        "USER",
        preset.id,
        "PermissionPreset",
        {
          name: preset.name,
          rules: preset.rules,
        },
        historyCfg,
        {
          changeNote: `Updated permission preset: ${preset.name}`,
          changeKind: "UPDATE_PARENT",
          changedPath: null,
          actorUserId: userId,
        },
      );

      // Invalidate compiled permissions cache for users with this preset
      await invalidatePresetCache(preset.id);

      res.json(toPermissionPresetDto(preset));
    }),
  );

  // POST /admin/permissions/presets/:id/versions — create new version
  server.post(
    "/admin/permissions/presets/:id/versions",
    requireAdminOrApiToken({
      policySignature: "POST /admin/permissions/presets/:id/versions" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_WRITE],
    })(async (req, res) => {
      const Body = z.object({
        rules: z.array(z.unknown()),
        changeNote: z.string().optional(),
      });
      const body = Body.parse(req.body);
      const userId = req.user?.id ?? systemUserId;

      const existing = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!existing) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      // Validate rules format
      const validRules = body.rules.filter((rule): rule is Permission => {
        return (
          typeof rule === "object" &&
          rule !== null &&
          typeof (rule as any).action === "string" &&
          typeof (rule as any).resource === "string"
        );
      });

      const preset = await db.permissionPreset.update({
        where: { id: req.params.id },
        data: {
          rules: validRules,
          version: { increment: 1 },
          updatedBy: userId,
        },
      });

      await appendChangeLog(
        db,
        "USER",
        preset.id,
        "PermissionPreset",
        {
          name: preset.name,
          rules: validRules,
        },
        historyCfg,
        {
          changeNote: body.changeNote ?? `Updated rules for permission preset: ${preset.name}`,
          changeKind: "UPDATE_CHILD",
          changedPath: "rules",
          actorUserId: userId,
        },
      );

      // Invalidate compiled permissions cache for users with this preset
      await invalidatePresetCache(preset.id);

      res.json(toPermissionPresetDto(preset));
    }),
  );

  // GET /admin/permissions/presets/:id/versions — list versions
  server.get(
    "/admin/permissions/presets/:id/versions",
    requireAdminOrApiToken({
      policySignature: "GET /admin/permissions/presets/:id/versions" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_READ],
    })(async (req, res) => {
      const preset = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!preset) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      const Q = z.object({
        limit: z.coerce.number().int().min(1).max(100).optional(),
        cursor: z.string().optional(),
      });
      const parsed = Q.safeParse(req.query ?? {});
      const query = parsed.success ? parsed.data : {};

      const take = query.limit ?? 20;
      const rows = await db.changeLog.findMany({
        where: {
          aggregateType: "PermissionPreset",
          aggregateId: preset.id,
        },
        orderBy: { version: "desc" },
        take: take + 1,
        cursor: query.cursor ? { id: query.cursor } : undefined,
        skip: query.cursor ? 1 : 0,
      });

      const hasMore = rows.length > take;
      const items = hasMore ? rows.slice(0, take) : rows;
      const nextCursor = hasMore ? items[items.length - 1]?.id : null;

      const versions = items.map((row: ChangeLogRow) => ({
        version: row.version,
        hash: row.hash,
        changeNote: row.changeNote,
        changedPath: row.changedPath,
        changeKind: row.changeKind,
        createdAt: row.createdAt.toISOString(),
        actorUserId: row.actorUserId,
      }));

      res.json({
        items: versions,
        nextCursor,
        hasMore,
      });
    }),
  );

  // GET /admin/permissions/presets/:id/versions/:version — get specific version
  server.get(
    "/admin/permissions/presets/:id/versions/:version",
    requireAdminOrApiToken({
      policySignature: "GET /admin/permissions/presets/:id/versions/:version" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_READ],
    })(async (req, res) => {
      const preset = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!preset) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      const version = parseInt(req.params.version, 10);
      if (isNaN(version)) {
        return res.status(400).json({ error: "Invalid version number" });
      }

      try {
        const historical = await materializeVersion(db, "PermissionPreset", preset.id, version);
        res.json({
          id: preset.id,
          name: historical.name,
          version,
          rules: historical.rules || [],
          rulesHash: Array.isArray(historical.rules) ? computeRulesHash(historical.rules as Permission[]) : "",
        });
      } catch (error) {
        res.status(404).json({ error: "Version not found" });
      }
    }),
  );

  // POST /admin/permissions/presets/:id/versions/:version/activate — rollback to version
  server.post(
    "/admin/permissions/presets/:id/versions/:version/activate",
    requireAdminOrApiToken({
      policySignature: "POST /admin/permissions/presets/:id/versions/:version/activate" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_WRITE],
    })(async (req, res) => {
      const userId = req.user?.id ?? systemUserId;
      const preset = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!preset) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      const version = parseInt(req.params.version, 10);
      if (isNaN(version)) {
        return res.status(400).json({ error: "Invalid version number" });
      }

      try {
        const historical = await materializeVersion(db, "PermissionPreset", preset.id, version);

        const updatedPreset = await db.permissionPreset.update({
          where: { id: req.params.id },
          data: {
            rules: historical.rules,
            version: { increment: 1 },
            updatedBy: userId,
          },
        });

        await appendChangeLog(
          db,
          "USER",
          updatedPreset.id,
          "PermissionPreset",
          {
            name: updatedPreset.name,
            rules: historical.rules,
          },
          historyCfg,
          {
            changeNote: `Rolled back to version ${version}`,
            changeKind: "UPDATE_PARENT",
            changedPath: "rules",
            actorUserId: userId,
          },
        );

        // Invalidate compiled permissions cache for users with this preset
        await invalidatePresetCache(updatedPreset.id);

        res.json(toPermissionPresetDto(updatedPreset));
      } catch (error) {
        res.status(404).json({ error: "Version not found" });
      }
    }),
  );

  // DELETE /admin/permissions/presets/:id — delete preset
  server.delete(
    "/admin/permissions/presets/:id",
    requireAdminOrApiToken({
      policySignature: "DELETE /admin/permissions/presets/:id" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_WRITE],
    })(async (req, res) => {
      const userId = req.user?.id ?? systemUserId;

      // Check if preset is in use
      const usersWithPreset = await db.user.count({
        where: { permissionPresetId: req.params.id },
      });

      if (usersWithPreset > 0) {
        return res.status(409).json({
          error: "DELETE_CONFLICT",
          message: `Permission preset is assigned to ${usersWithPreset} user(s)`,
        });
      }

      const preset = await db.permissionPreset.findUnique({
        where: { id: req.params.id },
      });

      if (!preset) {
        return res.status(404).json({ error: "Permission preset not found" });
      }

      await db.permissionPreset.delete({
        where: { id: req.params.id },
      });

      await appendChangeLog(
        db,
        "USER",
        preset.id,
        "PermissionPreset",
        null,
        historyCfg,
        {
          changeNote: `Deleted permission preset: ${preset.name}`,
          changeKind: "REMOVE_CHILD",
          changedPath: null,
          actorUserId: userId,
        },
      );

      res.status(204).send();
    }),
  );

  // POST /admin/permissions/simulate — simulate authorization decision
  server.post(
    "/admin/permissions/simulate",
    requireAdminOrApiToken({
      policySignature: "POST /admin/permissions/simulate" as RouteSignature,
      scopes: [SCOPES.PERMISSIONS_READ],
    })(async (req, res) => {
      const Body = z.object({
        userId: z.string(),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
        path: z.string(),
        body: z.unknown().optional(),
        query: z.record(z.unknown()).optional(),
        headers: z.record(z.string()).optional(),
      });
      const body = Body.parse(req.body);

      // Find the user
      const user = await db.user.findUnique({
        where: { id: body.userId },
        include: {
          permissionPreset: true,
        },
      });

      if (!user) {
        return res.status(404).json({ error: "User not found" });
      }

      // Build route signature
      const routeSignature = `${body.method} ${body.path}` as RouteSignature;
      const policyEntry = POLICY[routeSignature];

      if (!policyEntry) {
        return res.json({
          decision: "DENY",
          reason: "NO_POLICY",
          routeSignature,
          userId: user.id,
          userRole: user.role,
          message: "No policy defined for this route",
        });
      }

      // Simulate the request
      const simulatedReq = {
        method: body.method,
        path: body.path,
        body: body.body,
        query: body.query || {},
        headers: body.headers || {},
        params: {},
      };

      // Extract path parameters (simple implementation)
      const pathParts = body.path.split("/");
      const routeParts = routeSignature.split(" ")[1].split("/");
      const params: Record<string, string> = {};
      for (let i = 0; i < Math.min(pathParts.length, routeParts.length); i++) {
        if (routeParts[i].startsWith(":")) {
          const paramName = routeParts[i].substring(1);
          params[paramName] = pathParts[i];
        }
      }
      simulatedReq.params = params;

      // Build authorization context
      const context = buildContext({
        user,
        ...simulatedReq,
      });

      // Run authorization
      const authzResult = authorizeRequest({
        entry: policyEntry,
        signature: routeSignature,
        req: simulatedReq as any,
        context,
        user: {
          id: user.id,
          role: user.role,
          isActive: user.isActive,
          permissionsHash: user.permissionsHash,
          directPermissions: user.directPermissions,
          permissionPresetId: user.permissionPresetId,
          permissionPreset: user.permissionPreset,
        },
        evaluationMode: "shadow", // Always use shadow mode for simulation
        systemUserId,
      });

      const decision = authzResult.decision.ok ? "ALLOW" : "DENY";
      const reason = authzResult.decision.reason;

      // Record simulation metrics
      recordAuthzSimulation({
        evaluationMode: "shadow",
        policyOutcome: decision,
        effectiveDecision: decision,
        userRole: user.role,
        userId: user.id,
        presetId: authzResult.presetId,
        ruleId: authzResult.matchedRule?.id,
        rulesHash: authzResult.rulesHash,
      });

      const response = {
        decision,
        reason,
        routeSignature,
        userId: user.id,
        userRole: user.role,
        rulesHash: authzResult.rulesHash,
        ...(authzResult.matchedRule && {
          matchedRule: {
            id: authzResult.matchedRule.id,
            source: authzResult.matchedRule.source,
            where: authzResult.matchedRule.where,
            input: authzResult.matchedRule.input,
          },
        }),
        ...(authzResult.presetId && {
          presetId: authzResult.presetId,
          presetVersion: authzResult.presetVersion,
        }),
        message: getDecisionMessage(decision, reason),
      };

      res.json(response);
    }),
  );

  // Helper function to invalidate cache for users with a specific preset
  async function invalidatePresetCache(presetId: string) {
    try {
      const users = await db.user.findMany({
        where: { permissionPresetId: presetId },
        select: { permissionsHash: true },
      });

      for (const user of users) {
        if (user.permissionsHash) {
          invalidateCompiledPermissions(user.permissionsHash);
        }
      }
    } catch (error) {
      // Log error but don't fail the request
      console.warn("Failed to invalidate preset cache:", error);
    }
  }

  function getDecisionMessage(decision: string, reason: string): string {
    if (decision === "ALLOW") {
      switch (reason) {
        case "ADMIN":
          return "Request allowed because user has ADMIN role";
        case "RULE_MATCH":
          return "Request allowed by matching permission rule";
        default:
          return "Request allowed";
      }
    } else {
      switch (reason) {
        case "NO_POLICY":
          return "Request denied: no policy defined for this route";
        case "WHERE_MISS":
          return "Request denied: permission rule WHERE constraints not satisfied";
        case "INPUT_GUARD":
          return "Request denied: input validation failed";
        case "RATE_LIMIT":
          return "Request denied: rate limit exceeded";
        case "INACTIVE":
          return "Request denied: user account is inactive";
        case "MFA_REQUIRED":
          return "Request denied: two-factor authentication required";
        case "NO_MATCH":
          return "Request denied: no matching permission rule found";
        default:
          return "Request denied";
      }
    }
  }
}