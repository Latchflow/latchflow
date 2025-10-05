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

describe("scheduled trigger plugin", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.UTC(2024, 0, 1, 0, 0, 0)));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules emissions according to cron expression", async () => {
    const ctx = createContext({ mode: "cron", cron: { expression: "*/2 * * * *" } });
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
    expect(call.metadata.schedule).toMatchObject({
      kind: "cron",
      expression: "*/2 * * * *",
      timezone: "UTC",
      immediate: false,
    });
    expect(call.metadata.cron).toMatchObject({
      expression: "*/2 * * * *",
      timezone: "UTC",
      immediate: false,
    });
  });

  it("reschedules on config change", async () => {
    const ctx = createContext({ mode: "cron", cron: { expression: "*/5 * * * *" } });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });

    await runtime.onConfigChange({ mode: "cron", cron: { expression: "*/10 * * * *" } });
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
    const ctx = createContext({
      mode: "cron",
      cron: { expression: "0 * * * *" },
      emitOnStart: true,
    });
    const runtime = await triggerFactory(ctx);
    await runtime.start();
    expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    expect(ctx.services.emit.mock.calls[0][0].metadata.schedule.immediate).toBe(true);
  });

  it("stops scheduled timer", async () => {
    const ctx = createContext({ mode: "cron", cron: { expression: "* * * * *" } });
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

  it("fires exactly once for one-time schedules", async () => {
    const runAt = new Date(Date.UTC(2024, 0, 1, 0, 5, 0));
    const ctx = createContext({ mode: "one_time", runAt: runAt.toISOString() });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.advanceTimersByTimeAsync(4 * 60_000);
    expect(ctx.services.emit).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });

    const call = ctx.services.emit.mock.calls[0][0];
    expect(call.scheduledFor.toISOString()).toBe(runAt.toISOString());
    expect(call.metadata.schedule).toMatchObject({
      kind: "one_time",
      runAt: runAt.toISOString(),
      timezone: "UTC",
      immediate: false,
    });
    expect(runtime.state.hasFired).toBe(true);
    expect(runtime.state.nextRunAt).toBeNull();
  });

  it("fires immediately when runAt is in the past", async () => {
    const now = new Date(Date.UTC(2024, 0, 1, 0, 10, 0));
    const past = new Date(Date.UTC(2024, 0, 1, 0, 5, 0));
    vi.setSystemTime(now);
    const ctx = createContext({ mode: "one_time", once: { runAt: past.toISOString() } });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });
    const call = ctx.services.emit.mock.calls[0][0];
    expect(call.metadata.schedule.immediate).toBe(true);
    expect(call.metadata.schedule.runAt).toBe(past.toISOString());
  });

  it("re-schedules when runAt changes", async () => {
    const first = new Date(Date.UTC(2024, 0, 1, 0, 5, 0));
    const second = new Date(Date.UTC(2024, 0, 1, 0, 10, 0));
    const ctx = createContext({ mode: "one_time", runAt: first.toISOString() });
    const runtime = await triggerFactory(ctx);
    await runtime.start();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });

    ctx.services.emit.mockClear();
    await runtime.onConfigChange({ mode: "one_time", runAt: second.toISOString() });

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    await vi.waitFor(() => {
      expect(ctx.services.emit).toHaveBeenCalledTimes(1);
    });
    expect(ctx.services.emit.mock.calls[0][0].scheduledFor.toISOString()).toBe(
      second.toISOString(),
    );
  });
});
