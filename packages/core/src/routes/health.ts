import type { HttpServer } from "../http/http-server.js";

export function registerHealthRoutes(
  server: HttpServer,
  ctx: {
    queueName: string;
    storageName?: string;
    checkDb?: () => Promise<void>;
    checkQueue?: () => Promise<void>;
    checkStorage?: () => Promise<void>;
  },
) {
  // OpenAPI: /health
  server.get("/health", (_req, res) => {
    res
      .status(200)
      .json({ status: "ok", queue: ctx.queueName, storage: ctx.storageName ?? "unknown" });
  });

  // OpenAPI: /health/live
  server.get("/health/live", (_req, res) => {
    res.status(200).json({ status: "alive" });
  });

  // OpenAPI: /health/ready
  server.get("/health/ready", async (_req, res) => {
    const results: Record<string, "ok" | "error"> = { db: "ok", queue: "ok", storage: "ok" };
    const checks: Array<[key: keyof typeof results, fn: (() => Promise<void>) | undefined]> = [
      ["db", ctx.checkDb],
      ["queue", ctx.checkQueue],
      ["storage", ctx.checkStorage],
    ];
    const errors: string[] = [];
    for (const [key, fn] of checks) {
      if (!fn) continue;
      try {
        await fn();
      } catch (e) {
        results[key] = "error";
        errors.push(String((e as Error).message || e));
      }
    }
    const allOk = Object.values(results).every((v) => v === "ok");
    if (allOk) {
      res.status(200).json({ status: "ready", components: results });
    } else {
      res.status(503).json({
        status: "error",
        code: "NOT_READY",
        message: "One or more dependencies are not ready",
        components: results,
        details: { errors },
      });
    }
  });
}
