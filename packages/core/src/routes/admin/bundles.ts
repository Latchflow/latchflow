import type { HttpServer } from "../../http/http-server";

export function registerBundleAdminRoutes(server: HttpServer) {
  server.get("/admin/bundles", (_req, res) => {
    res
      .status(501)
      .json({ status: "error", code: "NOT_IMPLEMENTED", message: "Bundles list not implemented" });
  });
}
