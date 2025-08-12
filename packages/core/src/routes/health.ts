import type { HttpServer } from "../http/http-server.js";

export function registerHealthRoutes(
  server: HttpServer,
  ctx: { queueName: string; storageName?: string },
) {
  server.get("/health", (_req, res) => {
    res
      .status(200)
      .json({ status: "ok", queue: ctx.queueName, storage: ctx.storageName ?? "unknown" });
  });
}
