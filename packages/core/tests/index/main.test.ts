import { describe, it, expect, vi } from "vitest";

// Mock config to a minimal, valid configuration
vi.mock("../../src/config.js", () => ({
  loadConfig: () => ({
    DATABASE_URL: "postgres://x",
    PORT: 3456,
    PLUGINS_PATH: "packages/plugins",
    QUEUE_DRIVER: "memory",
    QUEUE_DRIVER_PATH: null,
    QUEUE_CONFIG_JSON: null,
    STORAGE_DRIVER: "fs",
    STORAGE_DRIVER_PATH: null,
    STORAGE_CONFIG_JSON: null,
    STORAGE_BASE_PATH: ".data",
    STORAGE_BUCKET: "b",
    STORAGE_KEY_PREFIX: "",
    ENCRYPTION_MODE: "none",
    AUTH_COOKIE_SECURE: false,
    ADMIN_UI_ORIGIN: undefined,
    RECIPIENT_SESSION_TTL_HOURS: 2,
    AUTH_SESSION_TTL_HOURS: 12,
    ADMIN_MAGICLINK_TTL_MIN: 15,
    RECIPIENT_OTP_TTL_MIN: 10,
    RECIPIENT_OTP_LENGTH: 6,
    DEVICE_CODE_TTL_MIN: 10,
    DEVICE_CODE_INTERVAL_SEC: 5,
    API_TOKEN_SCOPES_DEFAULT: ["core:read"],
    API_TOKEN_PREFIX: "lfk_",
  }),
  ADMIN_SESSION_COOKIE: "lf_admin_sess",
  RECIPIENT_SESSION_COOKIE: "lf_recipient_sess",
}));

// Mock DB and everything else used in main
vi.mock("../../src/db.js", () => ({ getDb: () => ({}) }));
vi.mock("../../src/plugins/plugin-loader.js", () => ({
  loadPlugins: vi.fn(async () => []),
  upsertPluginsIntoDb: vi.fn(async () => {}),
  PluginRuntimeRegistry: class {},
}));
vi.mock("../../src/storage/loader.js", () => ({
  loadStorage: vi.fn(async () => ({ name: "fs", storage: {} })),
}));
vi.mock("../../src/storage/service.js", () => ({
  createStorageService: vi.fn(() => ({})),
}));
vi.mock("../../src/queue/loader.js", () => ({
  loadQueue: vi.fn(async () => ({
    name: "memory",
    queue: { enqueueAction: vi.fn(), consumeActions: vi.fn() },
  })),
}));
vi.mock("../../src/runtime/action-runner.js", () => ({
  startActionConsumer: vi.fn(async () => {}),
}));
vi.mock("../../src/runtime/trigger-runner.js", () => ({
  startTriggerRunner: vi.fn(async () => ({})),
}));
const listen = vi.fn(async () => {});
const noop = vi.fn(() => {});
vi.mock("../../src/http/express-server.js", () => ({
  createExpressServer: vi.fn(() => ({
    get: noop,
    post: noop,
    put: noop,
    delete: noop,
    use: noop,
    listen,
  })),
}));
const regHealth = vi.fn();
const regAdmin = vi.fn();
const regRecipient = vi.fn();
const regCli = vi.fn();
vi.mock("../../src/routes/health.js", () => ({
  registerHealthRoutes: (...a: any[]) => regHealth(...a),
}));
vi.mock("../../src/routes/auth/admin.js", () => ({
  registerAdminAuthRoutes: (...a: any[]) => regAdmin(...a),
}));
vi.mock("../../src/routes/auth/recipient.js", () => ({
  registerRecipientAuthRoutes: (...a: any[]) => regRecipient(...a),
}));
vi.mock("../../src/routes/auth/cli.js", () => ({
  registerCliAuthRoutes: (...a: any[]) => regCli(...a),
}));

describe("main bootstrap", () => {
  it("starts server and registers routes", async () => {
    const { main } = await import("../../src/index.js");
    await main();
    expect(listen).toHaveBeenCalledWith(3456);
    expect(regHealth).toHaveBeenCalledTimes(1);
    expect(regAdmin).toHaveBeenCalledTimes(1);
    expect(regRecipient).toHaveBeenCalledTimes(1);
    expect(regCli).toHaveBeenCalledTimes(1);
  });
});
