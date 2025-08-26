import { describe, it, expect } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { loadStorage } from "../storage/loader.js";

describe("storage loader (named export)", () => {
  it("supports named createStorage factory via path", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-store-"));
    try {
      const modPath = path.join(dir, "custom.mjs");
      const content = `export async function createStorage(){ return { put: async()=>({size:0}), getStream: async()=>new (require('stream').Readable)({read(){this.push(null);}}), head: async()=>({size:0}), del: async()=>{} }; }`;
      await fs.promises.writeFile(modPath, content, "utf8");
      const { name, storage } = await loadStorage("custom", modPath, {});
      expect(name).toBe("custom");
      expect(storage).toBeTruthy();
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
