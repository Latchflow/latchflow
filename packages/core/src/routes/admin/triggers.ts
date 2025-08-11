import type { HttpServer } from "../../http/http-server";

export function registerTriggerAdminRoutes(server: HttpServer) {
  server.get("/admin/triggers", (_req, res) => {
    res
      .status(501)
      .json({ status: "error", code: "NOT_IMPLEMENTED", message: "Triggers list not implemented" });
  });
}
