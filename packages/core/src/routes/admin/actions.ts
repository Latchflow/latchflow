import type { HttpServer } from "../../http/http-server";

export function registerActionAdminRoutes(server: HttpServer) {
  server.get("/admin/actions", (_req, res) => {
    res
      .status(501)
      .json({ status: "error", code: "NOT_IMPLEMENTED", message: "Actions list not implemented" });
  });
}
