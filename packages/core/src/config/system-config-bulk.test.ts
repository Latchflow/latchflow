import { describe, it, expect, beforeEach, vi } from "vitest";
import { SystemConfigBulkService } from "./system-config-bulk.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";

vi.mock("../crypto/encryption.js", () => ({
  encryptValue: vi.fn(),
  decryptValue: vi.fn(),
}));

const mockEncryptValue = vi.mocked(encryptValue);
const mockDecryptValue = vi.mocked(decryptValue);

describe("SystemConfigBulkService", () => {
  let service: SystemConfigBulkService;
  let mockDb: any;
  let masterKey: Buffer;

  beforeEach(() => {
    vi.clearAllMocks();

    masterKey = Buffer.from("test-master-key-32-bytes-long!!!");

    const defaultFindUnique = vi.fn(async (args: any) => {
      if (args?.select?.schema) {
        return { schema: null };
      }
      return null;
    });

    mockDb = {
      systemConfig: {
        findUnique: defaultFindUnique,
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(async (fn: (tx: any) => Promise<any>) => fn(mockDb)),
    };

    service = new SystemConfigBulkService(mockDb, { masterKey });

    mockEncryptValue.mockReturnValue("encrypted:value:here");
    mockDecryptValue.mockReturnValue("decrypted-value");
  });

  describe("setBulk", () => {
    it("updates multiple configurations atomically", async () => {
      const configs = [
        {
          key: "SMTP_URL",
          value: "smtp://test.server.com:587",
          category: "email",
          isSecret: true,
        },
        {
          key: "SMTP_FROM",
          value: "test@example.com",
          category: "email",
          isSecret: false,
        },
      ];

      const now = new Date();
      mockDb.systemConfig.upsert
        .mockResolvedValueOnce({
          id: "cfg-1",
          key: "SMTP_URL",
          value: null,
          encrypted: "encrypted:value:here",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: "user1",
          updatedBy: null,
        })
        .mockResolvedValueOnce({
          id: "cfg-2",
          key: "SMTP_FROM",
          value: "test@example.com",
          encrypted: null,
          category: "email",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: "user1",
          updatedBy: null,
        });

      service.validateSchema = vi.fn().mockResolvedValue({ valid: true });

      const result = await service.setBulk(configs, "user1");

      expect(result.errors).toEqual([]);
      expect(result.success).toHaveLength(2);
      expect(result.success[0]).toMatchObject({
        key: "SMTP_URL",
        value: "smtp://test.server.com:587",
        source: "database",
      });
      expect(result.success[1]).toMatchObject({
        key: "SMTP_FROM",
        value: "test@example.com",
        source: "database",
      });
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
      expect(mockEncryptValue).toHaveBeenCalledWith("smtp://test.server.com:587", masterKey);

      const firstUpsert = mockDb.systemConfig.upsert.mock.calls[0][0];
      expect(firstUpsert.create.schema).toBeDefined();
    });

    it("returns validation failures without mutating data", async () => {
      const configs = [{ key: "INVALID", value: "bad", isSecret: false }];

      service.validateSchema = vi.fn().mockResolvedValue({
        valid: false,
        errors: ["Invalid value format"],
      });

      const result = await service.setBulk(configs, "user1");

      expect(result.success).toHaveLength(0);
      expect(result.errors).toEqual([
        { key: "INVALID", error: "Validation failed: Invalid value format" },
      ]);
      expect(mockDb.$transaction).not.toHaveBeenCalled();
    });

    it("reports secret type mismatches", async () => {
      const configs = [{ key: "SECRET_KEY", value: { not: "string" }, isSecret: true }];

      service.validateSchema = vi.fn().mockResolvedValue({ valid: true });

      const result = await service.setBulk(configs, "user1");

      expect(result.success).toHaveLength(0);
      expect(result.errors[0]).toEqual({
        key: "SECRET_KEY",
        error: "Secret values must be strings",
      });
    });

    it("requires values to be provided", async () => {
      const configs = [{ key: "MISSING_VALUE" }];

      const result = await service.setBulk(configs as any, "user1");

      expect(result.success).toHaveLength(0);
      expect(result.errors[0]).toEqual({
        key: "MISSING_VALUE",
        error: "Value is required",
      });
    });
  });

  describe("getFiltered", () => {
    it("redacts secrets when includeSecrets is false", async () => {
      const now = new Date();
      mockDb.systemConfig.findMany.mockResolvedValue([
        {
          id: "cfg-1",
          key: "SMTP_URL",
          value: null,
          encrypted: "encrypted:value",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
        },
      ]);

      const result = await service.getFiltered({ includeSecrets: false });

      expect(result[0]).toMatchObject({ key: "SMTP_URL", value: "[REDACTED]", source: "database" });
    });

    it("decrypts secrets when includeSecrets is true", async () => {
      const now = new Date();
      mockDb.systemConfig.findMany.mockResolvedValue([
        {
          id: "cfg-1",
          key: "SMTP_URL",
          value: null,
          encrypted: "encrypted:value",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: now,
          updatedAt: now,
          createdBy: null,
          updatedBy: null,
        },
      ]);
      mockDecryptValue.mockReturnValue("decrypted-secret");

      const result = await service.getFiltered({ includeSecrets: true });

      expect(result[0]).toMatchObject({
        key: "SMTP_URL",
        value: "decrypted-secret",
        source: "database",
      });
      expect(mockDecryptValue).toHaveBeenCalledWith("encrypted:value", masterKey);
    });

    it("throws when master key missing and includeSecrets is true", async () => {
      const serviceWithoutKey = new SystemConfigBulkService(mockDb);
      mockDb.systemConfig.findMany.mockResolvedValue([
        {
          id: "cfg-1",
          key: "SMTP_URL",
          value: null,
          encrypted: "encrypted:value",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
        },
      ]);

      await expect(serviceWithoutKey.getFiltered({ includeSecrets: true })).rejects.toThrow(
        /Master key required/,
      );
    });
  });
});
