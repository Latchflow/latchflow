import { describe, it, expect, beforeEach, vi } from "vitest";
import { SystemConfigBulkService } from "./system-config-bulk.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";

// Mock the crypto functions
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

    mockDb = {
      systemConfig: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      $transaction: vi.fn(),
    };

    service = new SystemConfigBulkService(mockDb, masterKey);

    // Set up default mock returns
    mockEncryptValue.mockReturnValue("encrypted:value:here");
    mockDecryptValue.mockReturnValue("decrypted-value");
  });

  describe("setBulk", () => {
    it("should update multiple configurations in a transaction", async () => {
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

      const mockResults = [
        {
          key: "SMTP_URL",
          value: null,
          encrypted: "encrypted:value:here",
          category: "email",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: "user1",
          updatedBy: null,
        },
        {
          key: "SMTP_FROM",
          value: "test@example.com",
          encrypted: null,
          category: "email",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: "user1",
          updatedBy: null,
        },
      ];

      // Mock transaction to call the callback with a transaction object
      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const tx = {
          systemConfig: {
            upsert: vi
              .fn()
              .mockResolvedValueOnce(mockResults[0])
              .mockResolvedValueOnce(mockResults[1]),
          },
        };
        return await callback(tx);
      });

      // Mock validation (we'll assume validateSchema passes for this test)
      service.validateSchema = vi.fn().mockResolvedValue({ valid: true });

      const result = await service.setBulk(configs, "user1");

      expect(result.success).toHaveLength(2);
      expect(result.errors).toHaveLength(0);
      expect(result.success[0].key).toBe("SMTP_URL");
      expect(result.success[0].value).toBe("smtp://test.server.com:587"); // Original value for secrets
      expect(result.success[1].key).toBe("SMTP_FROM");
      expect(result.success[1].value).toBe("test@example.com");

      expect(mockEncryptValue).toHaveBeenCalledWith("smtp://test.server.com:587", masterKey);
      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it("should handle validation errors", async () => {
      const configs = [
        {
          key: "INVALID_KEY",
          value: "invalid-value",
          category: "test",
          isSecret: false,
        },
      ];

      // Mock transaction
      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const tx = { systemConfig: { upsert: vi.fn() } };
        return await callback(tx);
      });

      // Mock validation failure
      service.validateSchema = vi.fn().mockResolvedValue({
        valid: false,
        errors: ["Invalid value format"],
      });

      await expect(service.setBulk(configs, "user1")).rejects.toThrow(
        "Bulk update failed for keys: INVALID_KEY",
      );

      expect(mockDb.$transaction).toHaveBeenCalled();
    });

    it("should handle encryption errors for secrets", async () => {
      const configs = [
        {
          key: "SECRET_KEY",
          value: { not: "string" }, // Invalid type for secret
          category: "test",
          isSecret: true,
        },
      ];

      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const tx = { systemConfig: { upsert: vi.fn() } };
        return await callback(tx);
      });

      service.validateSchema = vi.fn().mockResolvedValue({ valid: true });

      await expect(service.setBulk(configs, "user1")).rejects.toThrow(
        "Bulk update failed for keys: SECRET_KEY",
      );
    });

    it("should handle undefined values", async () => {
      const configs = [
        {
          key: "NO_VALUE_KEY",
          // value is undefined
          category: "test",
          isSecret: false,
        },
      ];

      mockDb.$transaction.mockImplementation(async (callback: any) => {
        const tx = { systemConfig: { upsert: vi.fn() } };
        return await callback(tx);
      });

      await expect(service.setBulk(configs, "user1")).rejects.toThrow(
        "Bulk update failed for keys: NO_VALUE_KEY",
      );
    });
  });

  describe("getFiltered", () => {
    it("should return filtered configurations with pagination", async () => {
      const mockConfigs = [
        {
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
        {
          key: "SMTP_FROM",
          value: "test@example.com",
          encrypted: null,
          category: "email",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
        },
      ];

      mockDb.systemConfig.findMany.mockResolvedValue(mockConfigs);
      mockDecryptValue.mockReturnValue("smtp://decrypted.server.com");

      const result = await service.getFiltered({
        category: "email",
        includeSecrets: true,
        offset: 0,
        limit: 10,
      });

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe("smtp://decrypted.server.com");
      expect(result[1].value).toBe("test@example.com");

      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { isActive: true, category: "email" },
        orderBy: [{ category: "asc" }, { key: "asc" }],
        skip: 0,
        take: 10,
      });
    });

    it("should redact secret values when includeSecrets is false", async () => {
      const mockConfigs = [
        {
          key: "SECRET_KEY",
          value: null,
          encrypted: "encrypted:value",
          category: "secrets",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
        },
      ];

      mockDb.systemConfig.findMany.mockResolvedValue(mockConfigs);

      const result = await service.getFiltered({
        includeSecrets: false,
      });

      expect(result[0].value).toBe("[REDACTED]");
      expect(mockDecryptValue).not.toHaveBeenCalled();
    });

    it("should filter by keys when provided", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([]);

      await service.getFiltered({
        keys: ["SMTP_URL", "SMTP_FROM"],
      });

      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { isActive: true, key: { in: ["SMTP_URL", "SMTP_FROM"] } },
        orderBy: [{ category: "asc" }, { key: "asc" }],
        skip: 0,
        take: 100,
      });
    });

    it("should use default pagination values", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([]);

      await service.getFiltered({});

      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { key: "asc" }],
        skip: 0,
        take: 100,
      });
    });

    it("should handle custom pagination", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([]);

      await service.getFiltered({
        offset: 20,
        limit: 50,
      });

      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { isActive: true },
        orderBy: [{ category: "asc" }, { key: "asc" }],
        skip: 20,
        take: 50,
      });
    });
  });
});
