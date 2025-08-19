import fs from "fs";
import path from "path";
import type { HttpServer } from "../http/http-server.js";

// Serves the bundled OpenAPI JSON from packages/core/openapi/dist/openapi.json
export function registerOpenApiRoute(server: HttpServer) {
  server.get("/openapi.json", async (_req, res) => {
    try {
      const filePath = path.resolve(__dirname, "../../openapi/dist/openapi.json");
      if (!fs.existsSync(filePath)) {
        res.status(404).json({
          status: "error",
          code: "OAS_NOT_BUNDLED",
          message: "OpenAPI bundle not found. Run pnpm oas:bundle.",
        });
        return;
      }
      const data = await fs.promises.readFile(filePath, "utf-8");
      res.header("Content-Type", "application/json").status(200).json(JSON.parse(data));
    } catch (e) {
      res
        .status(500)
        .json({ status: "error", code: "OAS_READ_ERROR", message: (e as Error).message });
    }
  });
}
