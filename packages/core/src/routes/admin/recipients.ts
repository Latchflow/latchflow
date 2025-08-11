import type { HttpServer } from "../../http/http-server";

export function registerRecipientAdminRoutes(server: HttpServer) {
  server.get("/admin/recipients", (_req, res) => {
    res
      .status(501)
      .json({
        status: "error",
        code: "NOT_IMPLEMENTED",
        message: "Recipients list not implemented",
      });
  });
}
