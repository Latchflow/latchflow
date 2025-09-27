import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSystemConfigAdminRoutes } from "./system-config.js";
import type { HttpHandler } from "../../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

const db = {} as Record<string, unknown>;

const { service, resetServiceMocks, getSystemConfigServiceMock } = vi.hoisted(() => {
  const service = {
    getFiltered: vi.fn(),
    setBulk: vi.fn(),
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    validateSchema: vi.fn(),
  } as const;

  const resetServiceMocks = () => {
    service.getFiltered.mockReset();
    service.setBulk.mockReset();
    service.get.mockReset();
    service.set.mockReset();
    service.delete.mockReset();
    service.validateSchema.mockReset();
  };

  return {
    service,
    resetServiceMocks,
    getSystemConfigServiceMock: vi.fn(async () => service),
  };
});

const { requireAdminOrApiTokenMock } = vi.hoisted(() => ({
  requireAdminOrApiTokenMock: vi.fn(() => (handler: HttpHandler) => handler),
}));

const { createTransportMock } = vi.hoisted(() => {
  const createTransportMock = vi.fn(() => ({
    verify: vi.fn(async () => ({})),
    close: vi.fn(),
  }));
  return { createTransportMock };
});

vi.mock("../../db/db.js", () => ({ getDb: () => db }));

vi.mock("../../config/system-config-startup.js", () => ({
  getSystemConfigService: getSystemConfigServiceMock,
}));

vi.mock("../../middleware/require-admin-or-api-token.js", () => ({
  requireAdminOrApiToken: requireAdminOrApiTokenMock,
}));

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
  createTransport: createTransportMock,
}));

function makeServer(overrides: Record<string, unknown> = {}) {
  const handlers = new Map<string, HttpHandler>();
  const server = {
    get: (path: string, handler: HttpHandler) => handlers.set(`GET ${path}`, handler),
    put: (path: string, handler: HttpHandler) => handlers.set(`PUT ${path}`, handler),
    post: (path: string, handler: HttpHandler) => handlers.set(`POST ${path}`, handler),
    delete: (path: string, handler: HttpHandler) => handlers.set(`DELETE ${path}`, handler),
  } as any;

  registerSystemConfigAdminRoutes(server, {
    SYSTEM_USER_ID: "system",
    HISTORY_SNAPSHOT_INTERVAL: 20,
    HISTORY_MAX_CHAIN_DEPTH: 200,
    ...overrides,
  } as any);

  return { handlers };
}

describe("SystemConfig admin routes", () => {
  beforeEach(() => {
    resetServiceMocks();
    getSystemConfigServiceMock.mockClear();
    requireAdminOrApiTokenMock.mockClear();
    createTransportMock.mockReset();
    createTransportMock.mockImplementation(() => ({
      verify: vi.fn(async () => ({})),
      close: vi.fn(),
    }));
  });

  it("GET /system/config masks secret values when includeSecrets is false", async () => {
    service.getFiltered.mockResolvedValue([
      {
        key: "SMTP_URL",
        value: "smtp://db.example",
        category: "email",
        schema: null,
        metadata: null,
        isSecret: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      },
    ]);

    const { handlers } = makeServer();
    const handler = handlers.get("GET /system/config")!;
    const rc = createResponseCapture();
    await handler({ query: {} } as any, rc.res);

    expect(service.getFiltered).toHaveBeenCalledWith({
      keys: undefined,
      category: undefined,
      includeSecrets: false,
      offset: 0,
      limit: 100,
    });
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({
      data: {
        configs: [
          {
            key: "SMTP_URL",
            value: "[REDACTED]",
            isSecret: true,
          },
        ],
      },
    });
  });

  it("GET /system/config includes secret values when includeSecrets=true", async () => {
    service.getFiltered.mockResolvedValue([
      {
        key: "SMTP_URL",
        value: "smtp://db.example",
        category: "email",
        schema: null,
        metadata: null,
        isSecret: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      },
    ]);

    const { handlers } = makeServer();
    const handler = handlers.get("GET /system/config")!;
    const rc = createResponseCapture();
    await handler({ query: { includeSecrets: "true" } } as any, rc.res);

    expect(service.getFiltered).toHaveBeenCalledWith({
      keys: undefined,
      category: undefined,
      includeSecrets: true,
      offset: 0,
      limit: 100,
    });
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({
      data: {
        configs: [
          {
            key: "SMTP_URL",
            value: "smtp://db.example",
            isSecret: true,
          },
        ],
      },
    });
  });

  it("PUT /system/config forwards bulk updates and returns success payload", async () => {
    const now = new Date();
    service.setBulk.mockResolvedValue({
      success: [
        {
          key: "LOG_LEVEL",
          value: "debug",
          category: "core",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: "user-1",
          updatedBy: "user-1",
          source: "database",
        },
      ],
      errors: [],
    });

    const { handlers } = makeServer();
    const handler = handlers.get("PUT /system/config")!;
    const rc = createResponseCapture();
    await handler(
      {
        body: { configs: [{ key: "LOG_LEVEL", value: "debug" }] },
        user: { id: "user-1" },
      } as any,
      rc.res,
    );

    expect(service.setBulk).toHaveBeenCalledWith([{ key: "LOG_LEVEL", value: "debug" }], "user-1");
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({
      data: {
        updated: [
          {
            key: "LOG_LEVEL",
            value: "debug",
          },
        ],
        count: 1,
      },
    });
  });

  it("PUT /system/config returns validation errors when service reports failures", async () => {
    service.setBulk.mockResolvedValue({
      success: [],
      errors: [{ key: "LOG_LEVEL", error: "Invalid value" }],
    });

    const { handlers } = makeServer();
    const handler = handlers.get("PUT /system/config")!;
    const rc = createResponseCapture();
    await handler({ body: { configs: [{ key: "LOG_LEVEL", value: 100 }] } } as any, rc.res);

    expect(rc.status).toBe(400);
    expect(rc.body).toMatchObject({
      code: "BULK_UPDATE_FAILED",
      data: {
        errors: [{ key: "LOG_LEVEL", error: "Invalid value" }],
      },
    });
  });

  it("POST /system/config/test validates email configs and tests connectivity", async () => {
    const now = new Date();
    const verifyMock = vi.fn(async () => ({}));
    const closeMock = vi.fn();
    createTransportMock.mockReturnValueOnce({ verify: verifyMock, close: closeMock });

    service.validateSchema.mockResolvedValue({ valid: true });
    service.get.mockResolvedValueOnce({
      key: "SMTP_FROM",
      value: "admin@example.com",
      category: "email",
      schema: null,
      metadata: null,
      isSecret: false,
      isActive: true,
      createdAt: now,
      updatedAt: now,
      createdBy: null,
      updatedBy: null,
      source: "database",
    });

    const { handlers } = makeServer();
    const handler = handlers.get("POST /system/config/test")!;
    const rc = createResponseCapture();

    await handler(
      {
        body: {
          category: "email",
          configs: [
            { key: "SMTP_URL", value: "smtp://smtp.example.com:1025" },
            { key: "SMTP_FROM", value: "ops@example.com" },
          ],
        },
      } as any,
      rc.res,
    );

    expect(service.validateSchema).toHaveBeenCalledTimes(2);
    expect(createTransportMock).toHaveBeenCalledWith({
      host: "smtp.example.com",
      port: 1025,
      secure: false,
      auth: undefined,
      ignoreTLS: false,
      connectionTimeout: 5000,
      greetingTimeout: 5000,
      socketTimeout: 5000,
    });
    expect(verifyMock).toHaveBeenCalled();
    expect(closeMock).toHaveBeenCalled();
    expect(rc.status).toBe(200);
    expect(rc.body).toMatchObject({
      data: {
        category: "email",
        valid: true,
        results: expect.arrayContaining([
          expect.objectContaining({ key: "SMTP_URL", valid: true }),
          expect.objectContaining({ key: "SMTP_FROM", valid: true }),
          expect.objectContaining({ key: "SMTP_CONNECTION", valid: true }),
        ]),
      },
    });
  });
});
