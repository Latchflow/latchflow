import { describe, it, expect, vi } from "vitest";

// Mock the S3 driver factory that loader resolves via "./s3.js"
const stubDriver = {
  put: vi.fn(),
  getStream: vi.fn(),
  head: vi.fn(),
  del: vi.fn(),
};
const createS3Storage = vi.fn(async (_opts: { config: unknown }) => stubDriver);

vi.mock("./s3.js", () => ({ createS3Storage }));

describe("storage/loader", () => {
  it("loads built-in s3 driver when driver = 's3' and no path provided", async () => {
    const { loadStorage } = await import("./loader.js");
    const res = await loadStorage("s3", null, { ensureBucket: true });
    expect(res.name).toBe("s3");
    expect(res.storage).toBe(stubDriver);
    expect(createS3Storage).toHaveBeenCalledWith({ config: { ensureBucket: true } });
  });
});
