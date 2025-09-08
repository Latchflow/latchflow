import { describe, it, expect } from "vitest";
import { toFileDto, type FileRecordLike } from "./file.js";

describe("toFileDto", () => {
  it("maps fields and converts BigInt + Date", () => {
    const rec: FileRecordLike = {
      id: "f1",
      key: "docs/readme.txt",
      size: BigInt(1234),
      contentType: "text/plain",
      metadata: { lang: "en" },
      contentHash: "a".repeat(64),
      updatedAt: new Date("2024-01-02T03:04:05.000Z"),
    };
    const dto = toFileDto(rec);
    expect(dto).toEqual({
      id: "f1",
      key: "docs/readme.txt",
      size: 1234,
      contentType: "text/plain",
      metadata: { lang: "en" },
      contentHash: "a".repeat(64),
      updatedAt: "2024-01-02T03:04:05.000Z",
    });
  });

  it("accepts number size and string updatedAt, omits etag/metadata when absent", () => {
    const rec: FileRecordLike = {
      id: "f2",
      key: "img/logo.png",
      size: 42,
      contentType: "image/png",
      updatedAt: "2025-01-01T00:00:00.000Z",
    } as any;
    const dto = toFileDto(rec);
    expect(dto.id).toBe("f2");
    expect(dto.key).toBe("img/logo.png");
    expect(dto.size).toBe(42);
    expect(dto.contentType).toBe("image/png");
    expect(dto.updatedAt).toBe("2025-01-01T00:00:00.000Z");
    expect("etag" in dto).toBe(false);
    expect("metadata" in dto).toBe(false);
  });
});
