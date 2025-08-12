import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadQueue } from "../src/queue/loader.js";

describe("queue loader", () => {
  it("loads memory queue by default", async () => {
    const { name, queue } = await loadQueue("memory", null, null);
    expect(name).toBe("memory");
    expect(typeof queue.enqueueAction).toBe("function");
  });

  it("loads custom queue via path", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-queue-"));
    try {
      const modPath = path.join(dir, "fake-queue.mjs");
      const content = `
      export default async function createQueue() {
        const msgs = [];
        let handler;
        return {
          async enqueueAction(m){ msgs.push(m); if (handler) await handler(msgs.shift()); },
          async consumeActions(h){ handler = h; },
          async stop(){},
        };
      }
    `;
      await fs.promises.writeFile(modPath, content, "utf8");

      const { name, queue } = await loadQueue("fake", modPath, {});
      expect(name).toBe("fake");
      let seen = "";
      await queue.consumeActions(async (m) => {
        seen = m.actionDefinitionId;
      });
      await queue.enqueueAction({ actionDefinitionId: "X", triggerEventId: "T" });
      await new Promise((r) => setTimeout(r, 5));
      expect(seen).toBe("X");
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
