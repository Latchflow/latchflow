import { describe, it, expect, beforeEach, vi } from "vitest";
import type { HttpHandler } from "../../src/http/http-server.js";
import { registerActionAdminRoutes } from "../../src/routes/admin/actions.js";
import { createResponseCapture } from "@tests/helpers/response";
import { createMemoryQueue } from "../../src/queue/memory-queue.js";
import { startActionConsumer } from "../../src/runtime/action-runner.js";
import { PluginRuntimeRegistry } from "../../src/plugins/plugin-loader.js";
import { createStubPluginServiceRegistry } from "../../src/services/stubs.js";
import { registerCoreBuiltinActions } from "../../src/plugins/core-plugin.js";

interface ActionRow {
  id: string;
  name: string;
  capabilityId: string;
  config: Record<string, unknown>;
  isEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
  createdBy: string;
  updatedBy?: string | null;
}

interface ChangeLogRow {
  version: number;
  entityId: string;
  isSnapshot: boolean;
  hash: string;
  changeNote: string | null;
  changedPath: string | null;
  changeKind: string | null;
  createdAt: Date;
  actorType: "USER" | "ACTION" | "SYSTEM";
  actorUserId: string | null;
  actorInvocationId: string | null;
  actorActionDefinitionId: string | null;
  onBehalfOfUserId: string | null;
  state: Record<string, unknown>;
}

const actions: ActionRow[] = [];
const changeLogs: ChangeLogRow[] = [];

const db = {
  actionDefinition: {
    findMany: vi.fn(async (args: any) => {
      const where = args?.where ?? {};
      let rows = [...actions];
      if (where.name?.contains) {
        const needle = where.name.contains.toLowerCase();
        rows = rows.filter((a) => a.name.toLowerCase().includes(needle));
      }
      if (typeof where.isEnabled === "boolean") {
        rows = rows.filter((a) => a.isEnabled === where.isEnabled);
      }
      if (where.updatedAt?.gte) {
        rows = rows.filter((a) => a.updatedAt >= where.updatedAt.gte);
      }
      if (where.capability?.is) {
        const capWhere = where.capability.is;
        if (capWhere?.pluginId) {
          rows = rows.filter((a) => a.capabilityId.startsWith(capWhere.pluginId as string));
        }
        if (capWhere?.key?.contains) {
          const needle = (capWhere.key.contains as string).toLowerCase();
          rows = rows.filter((a) => a.capabilityId.toLowerCase().includes(needle));
        }
      }
      rows.sort((a, b) => (a.id < b.id ? 1 : -1));
      if (args?.cursor) {
        const idx = rows.findIndex((r) => r.id === args.cursor.id);
        if (idx >= 0) rows = rows.slice(idx + 1);
      }
      return rows.slice(0, args?.take ?? 50);
    }),
    findUnique: vi.fn(async ({ where: { id } }: any) => actions.find((a) => a.id === id) ?? null),
    create: vi.fn(async ({ data }: any) => {
      const row: ActionRow = {
        id: data.id ?? `act_${actions.length + 1}`,
        name: data.name,
        capabilityId: data.capabilityId,
        config: data.config ?? {},
        isEnabled: data.isEnabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: data.createdBy ?? "admin",
        updatedBy: data.updatedBy ?? null,
      };
      actions.push(row);
      return row;
    }),
    update: vi.fn(async ({ where: { id }, data }: any) => {
      const idx = actions.findIndex((a) => a.id === id);
      if (idx === -1) throw new Error("NOT_FOUND");
      const current = actions[idx];
      const updated: ActionRow = {
        ...current,
        ...("name" in data ? { name: data.name } : {}),
        ...("config" in data ? { config: data.config } : {}),
        ...("isEnabled" in data ? { isEnabled: data.isEnabled } : {}),
        updatedAt: new Date(),
        updatedBy: data.updatedBy ?? current.updatedBy ?? null,
      };
      actions[idx] = updated;
      return updated;
    }),
    delete: vi.fn(async ({ where: { id } }: any) => {
      const idx = actions.findIndex((a) => a.id === id);
      if (idx === -1) throw new Error("NOT_FOUND");
      const [removed] = actions.splice(idx, 1);
      return removed;
    }),
  },
  pluginCapability: {
    findUnique: vi.fn(async ({ where: { id } }: any) => {
      if (id === "cap1") return { id, kind: "ACTION", isEnabled: true };
      if (id === "cap_core_email") return { id, kind: "ACTION", isEnabled: true };
      if (id === "cap-disabled") return { id, kind: "ACTION", isEnabled: false };
      return null;
    }),
  },
  actionInvocation: {
    count: vi.fn(async () => 0),
    create: vi.fn(async ({ data }: any) => ({
      id: `inv_${Math.random().toString(36).slice(2, 10)}`,
      ...data,
    })),
    update: vi.fn(async ({ where: { id }, data }: any) => ({ id, ...data })),
  },
  pipelineStep: {
    count: vi.fn(async () => 0),
  },
  changeLog: {
    findMany: vi.fn(async ({ where, take }: any) => {
      let rows = changeLogs.filter((cl) => cl.entityId === where.entityId);
      if (where.version?.lt) {
        rows = rows.filter((cl) => cl.version < where.version.lt);
      }
      rows.sort((a, b) => b.version - a.version);
      return rows.slice(0, take ?? 50).map(({ state, ...rest }) => rest);
    }),
    findFirst: vi.fn(async ({ where }: any) => {
      const row = changeLogs.find(
        (cl) => cl.entityId === where.entityId && cl.version === where.version,
      );
      if (!row) return null;
      const { state, ...rest } = row;
      return rest;
    }),
  },
};

vi.mock("../../src/db/db.js", () => ({ getDb: () => db }));

vi.mock("../../src/history/changelog.js", () => ({
  appendChangeLog: vi.fn(
    async (
      _db: unknown,
      _cfg: unknown,
      _entity: string,
      entityId: string,
      actor: any,
      opts?: any,
    ) => {
      const action = actions.find((a) => a.id === entityId);
      if (!action) throw new Error("missing action");
      const version = changeLogs.length + 1;
      const entry: ChangeLogRow = {
        version,
        entityId,
        isSnapshot: true,
        hash: `hash-${version}`,
        changeNote: opts?.changeNote ?? null,
        changedPath: opts?.changedPath ?? null,
        changeKind: opts?.changeKind ?? null,
        createdAt: new Date(),
        actorType: actor.actorType,
        actorUserId: actor.actorUserId ?? null,
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
        state: JSON.parse(JSON.stringify(action)),
      };
      changeLogs.push(entry);
      const { state, ...rest } = entry;
      return rest;
    },
  ),
  materializeVersion: vi.fn(
    async (_db: unknown, _entity: string, entityId: string, version: number) => {
      const row = changeLogs.find((cl) => cl.entityId === entityId && cl.version === version);
      return row ? JSON.parse(JSON.stringify(row.state)) : null;
    },
  ),
}));

vi.mock("../../src/middleware/require-session.js", () => ({
  requireSession: vi.fn(async () => ({ user: { id: "admin", role: "ADMIN" } })),
}));

describe("actions integration flow", () => {
  beforeEach(() => {
    actions.splice(0, actions.length);
    changeLogs.splice(0, changeLogs.length);
    for (const model of Object.values(db) as any[]) {
      for (const fn of Object.values(model) as any[]) {
        if (typeof fn?.mockClear === "function") fn.mockClear();
      }
    }
  });

  it("create → new version → activate → toggle → list → delete", async () => {
    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
      delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
    } as any;
    registerActionAdminRoutes(server, {
      queue: {
        enqueueAction: async () => {},
        consumeActions: async () => {},
        stop: async () => {},
      },
      config: {
        HISTORY_SNAPSHOT_INTERVAL: 10,
        HISTORY_MAX_CHAIN_DEPTH: 100,
        SYSTEM_USER_ID: "sys",
        ENCRYPTION_MODE: "none",
        ENCRYPTION_MASTER_KEY_B64: undefined,
      } as any,
      encryption: { mode: "none" },
    });

    const createRc = createResponseCapture();
    const createHandler = handlers.get("POST /actions")!;
    await createHandler(
      { body: { name: "Notify", capabilityId: "cap1", config: { to: "x" } } } as any,
      createRc.res,
    );
    expect(createRc.status).toBe(201);
    const actionId = createRc.body?.id as string;
    expect(actionId).toBeTruthy();

    const versionRc = createResponseCapture();
    const createVersion = handlers.get("POST /actions/:id/versions")!;
    await createVersion(
      { params: { id: actionId }, body: { config: { to: "y" }, changeNote: "update" } } as any,
      versionRc.res,
    );
    expect(versionRc.status).toBe(201);
    expect(changeLogs.length).toBe(2); // create + new version

    const activateRc = createResponseCapture();
    const activate = handlers.get("POST /actions/:id/versions/:version/activate")!;
    await activate({ params: { id: actionId, version: "1" } } as any, activateRc.res);
    expect(activateRc.status).toBe(204);
    const current = actions.find((a) => a.id === actionId);
    expect(current?.config).toEqual({ to: "x" });

    const patchRc = createResponseCapture();
    const patch = handlers.get("PATCH /actions/:id")!;
    await patch({ params: { id: actionId }, body: { isEnabled: false } } as any, patchRc.res);
    expect(patchRc.status).toBe(204);
    const afterPatch = actions.find((a) => a.id === actionId);
    expect(afterPatch?.isEnabled).toBe(false);

    const listRc = createResponseCapture();
    const list = handlers.get("GET /actions")!;
    await list({ query: { q: "notify" } } as any, listRc.res);
    expect(listRc.status).toBe(200);
    expect(listRc.body?.items?.length).toBe(1);

    const deleteRc = createResponseCapture();
    const del = handlers.get("DELETE /actions/:id")!;
    await del({ params: { id: actionId } } as any, deleteRc.res);
    expect(deleteRc.status).toBe(204);
    expect(actions.length).toBe(0);
  });

  it("POST /actions/:id/test-run executes built-in email action through the queue", async () => {
    const builtinCapabilityId = "cap_core_email";
    const builtinDefinitionId = "act_core_email";
    const emailService = {
      sendEmail: vi.fn(async () => ({ delivered: true })),
    };
    const queue = await createMemoryQueue({ config: null });
    const runtime = new PluginRuntimeRegistry(createStubPluginServiceRegistry());
    registerCoreBuiltinActions(runtime, {
      emailCapabilityId: builtinCapabilityId,
      emailService: emailService as any,
    });
    await startActionConsumer(queue, { registry: runtime, encryption: { mode: "none" } });

    const handlers = new Map<string, HttpHandler>();
    const server = {
      get: (p: string, h: HttpHandler) => handlers.set(`GET ${p}`, h),
      post: (p: string, h: HttpHandler) => handlers.set(`POST ${p}`, h),
      patch: (p: string, h: HttpHandler) => handlers.set(`PATCH ${p}`, h),
      delete: (p: string, h: HttpHandler) => handlers.set(`DELETE ${p}`, h),
    } as any;

    const now = new Date();
    actions.push({
      id: builtinDefinitionId,
      name: "Core Email",
      capabilityId: builtinCapabilityId,
      config: {
        to: [{ address: "base@example.com" }],
        subject: "Base Subject",
      },
      isEnabled: true,
      createdAt: now,
      updatedAt: now,
      createdBy: "admin",
      updatedBy: null,
    });

    try {
      registerActionAdminRoutes(server, {
        queue,
        config: {
          HISTORY_SNAPSHOT_INTERVAL: 10,
          HISTORY_MAX_CHAIN_DEPTH: 100,
          SYSTEM_USER_ID: "sys",
          ENCRYPTION_MODE: "none",
          ENCRYPTION_MASTER_KEY_B64: undefined,
        } as any,
        encryption: { mode: "none" },
        runtime,
      });

      const handler = handlers.get("POST /actions/:id/test-run")!;
      const rc = createResponseCapture();
      await handler(
        {
          params: { id: builtinDefinitionId },
          body: {
            context: {
              to: [{ address: "override@example.com" }],
              subject: "Override Subject",
              textBody: "Hello",
            },
          },
          user: { id: "admin" },
        } as any,
        rc.res,
      );

      expect(rc.status).toBe(202);
      await vi.waitFor(() => {
        expect(emailService.sendEmail).toHaveBeenCalledTimes(1);
      });
      expect(emailService.sendEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: [{ address: "override@example.com" }],
          subject: "Override Subject",
          textBody: "Hello",
        }),
      );
    } finally {
      actions.pop();
      await queue.stop();
    }
  });
});
