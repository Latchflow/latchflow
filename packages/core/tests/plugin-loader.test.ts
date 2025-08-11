import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import { loadPlugins } from "../src/plugins/plugin-loader";

describe("plugin-loader", () => {
  it("loads capabilities from a plugin directory", async () => {
    const tmpDir = path.join(__dirname, "fixtures", "plugins", "fake");
    await fs.promises.mkdir(tmpDir, { recursive: true });
    const modContent = [
      "export const capabilities = [",
      "  { kind: 'TRIGGER', key: 'cron_schedule', displayName: 'Cron Schedule' },",
      "];",
    ].join("\n");
    await fs.promises.writeFile(path.join(tmpDir, "index.mjs"), modContent, "utf8");

    const plugins = await loadPlugins(
      path.join("packages", "core", "tests", "fixtures", "plugins"),
    );
    expect(plugins.length).toBeGreaterThan(0);
    expect(plugins[0].capabilities[0]).toMatchObject({ key: "cron_schedule", kind: "TRIGGER" });
  });
});
