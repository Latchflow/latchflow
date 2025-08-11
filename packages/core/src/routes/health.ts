import type { HttpServer } from "../http/http-server";

export function registerHealthRoutes(server: HttpServer, ctx: { queueName: string }) {
  server.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", queue: ctx.queueName });
  });
}
