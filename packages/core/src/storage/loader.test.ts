import { describe, it, expect } from "vitest";
import { loadStorage } from "../storage/loader.js";

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
});
