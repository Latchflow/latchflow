import { describe, it, expect } from "vitest";
import { loadStorage } from "../storage/loader.js";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

describe("storage loader", () => {
  it("loads memory storage by default", async () => {
    const { name, storage } = await loadStorage("memory", null, null);
    expect(name).toBe("memory");
    expect(storage).toBeTruthy();
  });
  it("loads fs storage when specified", async () => {
    const { name, storage } = await loadStorage("fs", null, { basePath: ".data" });
    expect(name).toBe("fs");
    expect(storage).toBeTruthy();
  });

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

  it("supports default-exported factory via path", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "lf-store-def-"));
    try {
      const modPath = path.join(dir, "custom.mjs");
      const content = `export default async function(){ return { put: async()=>({size:0}), getStream: async()=>new (require('stream').Readable)({read(){this.push(null);}}), head: async()=>({size:0}), del: async()=>{} }; }`;
      await fs.promises.writeFile(modPath, content, "utf8");
      const { name, storage } = await loadStorage("custom", modPath, {});
      expect(name).toBe("custom");
      expect(storage).toBeTruthy();
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true });
    }
  });
});
