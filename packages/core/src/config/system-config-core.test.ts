import { describe, it, expect, beforeEach, vi } from "vitest";
import { SystemConfigService } from "./system-config-core.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";

// Mock the crypto functions
vi.mock("../crypto/encryption.js", () => ({
  encryptValue: vi.fn(),
  decryptValue: vi.fn(),
}));

const mockEncryptValue = vi.mocked(encryptValue);
const mockDecryptValue = vi.mocked(decryptValue);

describe("SystemConfigService", () => {
  let service: SystemConfigService;
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
        updateMany: vi.fn(),
      },
    };

    service = new SystemConfigService(mockDb, masterKey);

    // Set up default mock returns
    mockEncryptValue.mockReturnValue("encrypted:value:here");
    mockDecryptValue.mockReturnValue("decrypted-value");
  });

  describe("get", () => {
    it("should return config from database when found", async () => {
      const mockConfig = {
        key: "test-key",
        value: { some: "value" },
        encrypted: null,
        category: "test",
        schema: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "user1",
        updatedBy: null,
      };

      mockDb.systemConfig.findUnique.mockResolvedValue(mockConfig);

      const result = await service.get("test-key");

      expect(result).toEqual({
        key: "test-key",
        value: { some: "value" },
        category: "test",
        schema: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: mockConfig.createdAt,
        updatedAt: mockConfig.updatedAt,
        createdBy: "user1",
        updatedBy: null,
      });

      expect(mockDb.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: "test-key", isActive: true },
      });
    });

    it("should decrypt secret values", async () => {
      const mockConfig = {
        key: "secret-key",
        value: null,
        encrypted: "encrypted:secret:value",
        category: "secrets",
        schema: null,
        metadata: null,
        isSecret: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "user1",
        updatedBy: null,
      };

      mockDb.systemConfig.findUnique.mockResolvedValue(mockConfig);
      mockDecryptValue.mockReturnValue("secret-value");

      const result = await service.get("secret-key");

      expect(result?.value).toBe("secret-value");
      expect(mockDecryptValue).toHaveBeenCalledWith("encrypted:secret:value", masterKey);
    });

    it("should fallback to environment variable when not in database", async () => {
      mockDb.systemConfig.findUnique.mockResolvedValue(null);

      // Mock process.env
      const originalEnv = process.env.TEST_VAR;
      process.env.TEST_VAR = "env-value";

      const result = await service.get("TEST_VAR");

      expect(result).toEqual({
        key: "TEST_VAR",
        value: "env-value",
        category: null,
        schema: null,
        metadata: { source: "environment" },
        isSecret: false,
        isActive: true,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        createdBy: null,
        updatedBy: null,
      });

      // Restore original env
      if (originalEnv !== undefined) {
        process.env.TEST_VAR = originalEnv;
      } else {
        delete process.env.TEST_VAR;
      }
    });

    it("should return null when not found in database or environment", async () => {
      mockDb.systemConfig.findUnique.mockResolvedValue(null);
      delete process.env.NONEXISTENT_VAR;

      const result = await service.get("NONEXISTENT_VAR");

      expect(result).toBeNull();
    });

    it("should throw error when master key missing for secret", async () => {
      const serviceWithoutKey = new SystemConfigService(mockDb);
      const mockConfig = {
        key: "secret-key",
        value: null,
        encrypted: "encrypted:value",
        isSecret: true,
        isActive: true,
        category: null,
        schema: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      };

      mockDb.systemConfig.findUnique.mockResolvedValue(mockConfig);

      await expect(serviceWithoutKey.get("secret-key")).rejects.toThrow(
        "Master key required for decrypting secret values",
      );
    });
  });

  describe("getAll", () => {
    it("should return all active configs", async () => {
      const mockConfigs = [
        {
          key: "key1",
          value: "value1",
          encrypted: null,
          category: "test",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          createdBy: null,
          updatedBy: null,
        },
        {
          key: "key2",
          value: null,
          encrypted: "encrypted:value",
          category: "test",
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
      mockDecryptValue.mockReturnValue("decrypted-secret");

      const result = await service.getAll();

      expect(result).toHaveLength(2);
      expect(result[0].value).toBe("value1");
      expect(result[1].value).toBe("decrypted-secret");
      expect(mockDecryptValue).toHaveBeenCalledWith("encrypted:value", masterKey);
    });

    it("should filter by category when provided", async () => {
      mockDb.systemConfig.findMany.mockResolvedValue([]);

      await service.getAll("email");

      expect(mockDb.systemConfig.findMany).toHaveBeenCalledWith({
        where: { isActive: true, category: "email" },
        orderBy: [{ category: "asc" }, { key: "asc" }],
      });
    });
  });

  describe("set", () => {
    it("should create/update non-secret config", async () => {
      const mockConfig = {
        key: "test-key",
        value: "test-value",
        encrypted: null,
        category: "test",
        schema: null,
        metadata: { description: "test config" },
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "user1",
        updatedBy: null,
      };

      mockDb.systemConfig.upsert.mockResolvedValue(mockConfig);

      const result = await service.set("test-key", "test-value", {
        category: "test",
        metadata: { description: "test config" },
        userId: "user1",
      });

      expect(result.value).toBe("test-value");
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "test-key" },
        create: {
          key: "test-key",
          value: "test-value",
          encrypted: undefined,
          category: "test",
          schema: undefined,
          metadata: { description: "test config" },
          isSecret: false,
          createdBy: "user1",
        },
        update: {
          value: "test-value",
          encrypted: undefined,
          category: "test",
          schema: undefined,
          metadata: { description: "test config" },
          isSecret: false,
          updatedBy: "user1",
        },
      });
    });

    it("should encrypt secret values", async () => {
      const mockConfig = {
        key: "secret-key",
        value: null,
        encrypted: "encrypted:secret:value",
        category: "secrets",
        schema: null,
        metadata: null,
        isSecret: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "user1",
        updatedBy: null,
      };

      mockDb.systemConfig.upsert.mockResolvedValue(mockConfig);
      mockEncryptValue.mockReturnValue("encrypted:secret:value");

      const result = await service.set("secret-key", "secret-value", {
        isSecret: true,
        userId: "user1",
      });

      expect(result.value).toBe("secret-value");
      expect(mockEncryptValue).toHaveBeenCalledWith("secret-value", masterKey);
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith({
        where: { key: "secret-key" },
        create: {
          key: "secret-key",
          value: undefined,
          encrypted: "encrypted:secret:value",
          category: undefined,
          schema: undefined,
          metadata: undefined,
          isSecret: true,
          createdBy: "user1",
        },
        update: {
          value: undefined,
          encrypted: "encrypted:secret:value",
          category: undefined,
          schema: undefined,
          metadata: undefined,
          isSecret: true,
          updatedBy: "user1",
        },
      });
    });

    it("should throw error when master key missing for secret", async () => {
      const serviceWithoutKey = new SystemConfigService(mockDb);

      await expect(
        serviceWithoutKey.set("secret-key", "secret-value", { isSecret: true }),
      ).rejects.toThrow("Master key required for encrypting secret values");
    });

    it("should throw error when secret value is not a string", async () => {
      await expect(
        service.set("secret-key", { not: "string" }, { isSecret: true }),
      ).rejects.toThrow("Secret values must be strings");
    });
  });

  describe("delete", () => {
    it("should soft delete config by setting isActive to false", async () => {
      mockDb.systemConfig.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.delete("test-key", "user1");

      expect(result).toBe(true);
      expect(mockDb.systemConfig.updateMany).toHaveBeenCalledWith({
        where: { key: "test-key" },
        data: { isActive: false, updatedBy: "user1" },
      });
    });

    it("should return false when config not found", async () => {
      mockDb.systemConfig.updateMany.mockResolvedValue({ count: 0 });

      const result = await service.delete("nonexistent-key");

      expect(result).toBe(false);
    });
  });

  describe("seedFromEnvironment", () => {
    it("should seed configs from environment variables", async () => {
      const originalSmtpUrl = process.env.SMTP_URL;
      const originalSmtpFrom = process.env.SMTP_FROM;

      process.env.SMTP_URL = "smtp://localhost:1025";
      process.env.SMTP_FROM = "test@example.com";

      mockDb.systemConfig.findUnique
        .mockResolvedValueOnce(null) // SMTP_URL not exists
        .mockResolvedValueOnce(null); // SMTP_FROM not exists

      const mockUpsertResult = {
        key: "SMTP_URL",
        value: null,
        encrypted: "encrypted:value",
        category: "email",
        schema: null,
        metadata: { source: "environment_seed" },
        isSecret: true,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: "system",
        updatedBy: null,
      };

      mockDb.systemConfig.upsert.mockResolvedValue(mockUpsertResult);

      const envMapping = {
        SMTP_URL: { category: "email", isSecret: true },
        SMTP_FROM: { category: "email", isSecret: false },
      };

      await service.seedFromEnvironment(envMapping, "system");

      expect(mockDb.systemConfig.findUnique).toHaveBeenCalledTimes(2);
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledTimes(2);

      // Restore env vars
      if (originalSmtpUrl !== undefined) {
        process.env.SMTP_URL = originalSmtpUrl;
      } else {
        delete process.env.SMTP_URL;
      }
      if (originalSmtpFrom !== undefined) {
        process.env.SMTP_FROM = originalSmtpFrom;
      } else {
        delete process.env.SMTP_FROM;
      }
    });

    it("should skip seeding if config already exists", async () => {
      const originalVar = process.env.EXISTING_VAR;
      process.env.EXISTING_VAR = "value";

      mockDb.systemConfig.findUnique.mockResolvedValue({
        key: "EXISTING_VAR",
        value: "existing-value",
      });

      await service.seedFromEnvironment({ EXISTING_VAR: { category: "test" } }, "system");

      expect(mockDb.systemConfig.upsert).not.toHaveBeenCalled();

      // Restore env var
      if (originalVar !== undefined) {
        process.env.EXISTING_VAR = originalVar;
      } else {
        delete process.env.EXISTING_VAR;
      }
    });
  });

  describe("validateSchema", () => {
    it("should delegate to validator", async () => {
      const mockConfigValue = {
        key: "test-key",
        value: "test-value",
        schema: { type: "string" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
      };

      mockDb.systemConfig.findUnique.mockResolvedValue(mockConfigValue);

      const result = await service.validateSchema("test-key", "valid-string");

      expect(result.valid).toBe(true);
      expect(mockDb.systemConfig.findUnique).toHaveBeenCalledWith({
        where: { key: "test-key", isActive: true },
      });
    });
  });
});
