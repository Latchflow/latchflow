import { QueueFactory, LatchflowQueue } from "./types";

function resolveQueueFactory(mod: unknown): QueueFactory {
  const obj = mod as Record<string, unknown>;
  const maybeDefault = obj.default;
  if (typeof maybeDefault === "function") {
    return maybeDefault as QueueFactory;
  }
  const maybeCreate = obj.createQueue;
  if (typeof maybeCreate === "function") {
    return maybeCreate as QueueFactory;
  }
  throw new Error("Queue module does not export a factory");
}

export async function loadQueue(
  driver: string,
  pathOrNull: string | null,
  config: unknown,
): Promise<{ name: string; queue: LatchflowQueue }> {
  if (!driver || driver === "memory") {
    const { createMemoryQueue } = await import("./memory-queue");
    return { name: "memory", queue: await createMemoryQueue({ config }) };
  }
  if (pathOrNull) {
    const mod = await import(pathOrNull);
    const factory = resolveQueueFactory(mod);
    return { name: driver, queue: await factory({ config }) };
  }
  const mod = await import("packages/plugins/queue/" + driver).catch(() => import(driver));
  const factory = resolveQueueFactory(mod);
  return { name: driver, queue: await factory({ config }) };
}
