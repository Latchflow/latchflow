import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import plugin from "../index.js";

const triggerFactory = plugin.triggers.cron_schedule;

function createContext(config) {
  const emit = vi.fn(async () => {});
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  return {
    definitionId: "def-1",
    capability: plugin.capabilities[0],
    plugin: { name: plugin.name },
    config,
    services: {
      emit,
      logger,
    },
  };
}

describe("cron trigger plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 1, 0, 0, 0)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules emissions according to cron expression", async () => {
    const ctx = createContext({ expression: "*/2 * * * *" });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.advanceTimersByTimeAsync(60_000); // 00:01 -> no emit yet
    expect(ctx.services.emit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000); // 00:02
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });
    const call = ctx.services.emit.mock.calls[0][0];
    expect(call.scheduledFor).toBeInstanceOf(Date);
    expect(call.scheduledFor.toISOString()).toBe("2024-01-01T00:02:00.000Z");
    expect(call.metadata).toMatchObject({ cron: { expression: "*/2 * * * *", timezone: "UTC" } });
  });

  it("reschedules on config change", async () => {
    const ctx = createContext({ expression: "*/5 * * * *" });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });

    await runtime.onConfigChange({ expression: "*/10 * * * *" });
    ctx.services.emit.mockClear();
    vi.setSystemTime(new Date("2024-01-01T00:05:00Z"));

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(2);
    });
  });

  it("emits immediately when emitOnStart is true", async () => {
    const ctx = createContext({ expression: "0 * * * *", emitOnStart: true });
    const runtime = await triggerFactory(ctx);
    await runtime.start();
    expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    expect(ctx.services.emit.mock.calls[0][0].metadata.cron.immediate).toBe(true);
  });

  it("stops scheduled timer", async () => {
    const ctx = createContext({ expression: "* * * * *" });
    const runtime = await triggerFactory(ctx);
    await runtime.start();
    await runtime.stop();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(ctx.services.emit).not.toHaveBeenCalled();
  });

  it("rejects invalid expressions", () => {
    const ctx = createContext({ expression: "invalid" });
    expect(() => triggerFactory(ctx)).toThrow(/Cron expression/);
  });
});
