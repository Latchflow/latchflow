import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadPlugins } from "../plugins/plugin-loader";

describe("plugin-loader", () => {
  it("loads capabilities from a plugin directory", async () => {
    const base = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-plugins-"));
    try {
      const tmpDir = path.join(base, "fake");
      await fs.promises.mkdir(tmpDir, { recursive: true });
      const modContent = [
        "module.exports = {",
        "  capabilities: [",
        "    { kind: 'TRIGGER', key: 'cron_schedule', displayName: 'Cron Schedule' }",
        "  ]",
        "};",
      ].join("\n");
      await fs.promises.writeFile(path.join(tmpDir, "index.js"), modContent, "utf8");

      const plugins = await loadPlugins(base);
      expect(plugins.length).toBeGreaterThan(0);
      expect(plugins[0].capabilities[0]).toMatchObject({ key: "cron_schedule", kind: "TRIGGER" });
    } finally {
      await fs.promises.rm(base, { recursive: true, force: true });
    }
  });
});
