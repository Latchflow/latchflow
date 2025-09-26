import { describe, it, expect, beforeEach, vi } from "vitest";
import { SystemConfigService } from "./system-config-core.js";
import { encryptValue, decryptValue } from "../crypto/encryption.js";

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
        update: vi.fn(),
      },
      $transaction: vi.fn(async (callback: (tx: any) => Promise<any>) => callback(mockDb)),
    };

    service = new SystemConfigService(mockDb, { masterKey });

    mockEncryptValue.mockReturnValue("encrypted:value:here");
    mockDecryptValue.mockReturnValue("decrypted-value");
  });

  describe("get", () => {
    it("returns config from database when present", async () => {
      const mockConfig = {
        id: "cfg-1",
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

      mockDb.systemConfig.findUnique.mockImplementation(async (args: any) => {
        if (args?.select?.schema) return { schema: null };
        if (args?.where?.key === "test-key" && args?.where?.isActive === true) {
          return mockConfig;
        }
        return null;
      });

      const result = await service.get("test-key");

      expect(result).toMatchObject({
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
        source: "database",
      });
    });

    it("decrypts secret values", async () => {
      const mockConfig = {
        id: "cfg-secret",
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

      mockDb.systemConfig.findUnique.mockImplementation(async (args: any) => {
        if (args?.select?.schema) return { schema: null };
        if (args?.where?.key === "secret-key" && args?.where?.isActive === true) {
          return mockConfig;
        }
        return null;
      });
      mockDecryptValue.mockReturnValue("secret-value");

      const result = await service.get("secret-key");

      expect(result?.value).toBe("secret-value");
      expect(result?.source).toBe("database");
      expect(mockDecryptValue).toHaveBeenCalledWith("encrypted:secret:value", masterKey);
    });

    it("falls back to environment variables", async () => {
      process.env.TEST_VAR = "env-value";
      const result = await service.get("TEST_VAR");

      expect(result).toMatchObject({
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
        source: "environment",
      });

      delete process.env.TEST_VAR;
    });

    it("throws when master key missing for secret", async () => {
      const secretService = new SystemConfigService(mockDb);
      const mockConfig = {
        id: "cfg-secret",
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

      mockDb.systemConfig.findUnique.mockImplementation(async (args: any) => {
        if (args?.select?.schema) return { schema: null };
        if (args?.where?.key === "secret-key" && args?.where?.isActive === true) {
          return mockConfig;
        }
        return null;
      });

      await expect(secretService.get("secret-key")).rejects.toThrow(/Master key required/);
    });
  });

  describe("getAll", () => {
    it("returns decrypted configs", async () => {
      const created = new Date();
      const mockConfigs = [
        {
          id: "cfg-1",
          key: "key1",
          value: "value1",
          encrypted: null,
          category: "test",
          schema: null,
          metadata: null,
          isSecret: false,
          isActive: true,
          createdAt: created,
          updatedAt: created,
          createdBy: null,
          updatedBy: null,
        },
        {
          id: "cfg-2",
          key: "key2",
          value: null,
          encrypted: "encrypted:value",
          category: "test",
          schema: null,
          metadata: null,
          isSecret: true,
          isActive: true,
          createdAt: created,
          updatedAt: created,
          createdBy: null,
          updatedBy: null,
        },
      ];

      mockDb.systemConfig.findMany.mockResolvedValue(mockConfigs);
      mockDecryptValue.mockReturnValue("decrypted-secret");

      const result = await service.getAll();

      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({ value: "value1", source: "database" });
      expect(result[1]).toMatchObject({ value: "decrypted-secret", source: "database" });
    });
  });

  describe("set", () => {
    it("creates or updates non-secret config", async () => {
      const mockConfig = {
        id: "cfg-1",
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
      expect(result.source).toBe("database");
      expect(mockDb.$transaction).toHaveBeenCalledTimes(1);
      expect(mockDb.systemConfig.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { key: "test-key" },
          create: expect.objectContaining({
            key: "test-key",
            value: "test-value",
            category: "test",
            isSecret: false,
            createdBy: "user1",
          }),
          update: expect.objectContaining({
            value: "test-value",
            category: "test",
            isSecret: false,
            updatedBy: "user1",
          }),
        }),
      );
    });

    it("encrypts secret values", async () => {
      const mockConfig = {
        id: "cfg-2",
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

      mockEncryptValue.mockReturnValue("encrypted:secret:value");
      mockDb.systemConfig.upsert.mockResolvedValue(mockConfig);

      const result = await service.set("secret-key", "secret-value", {
        isSecret: true,
        userId: "user1",
      });

      expect(result.value).toBe("secret-value");
      expect(result.source).toBe("database");
      expect(mockEncryptValue).toHaveBeenCalledWith("secret-value", masterKey);
    });

    it("rejects non-string secret values", async () => {
      await expect(
        service.set("secret-key", { not: "string" }, { isSecret: true }),
      ).rejects.toThrow("Secret values must be strings");
    });
  });

  describe("delete", () => {
    it("soft deletes existing config", async () => {
      const now = new Date();
      const mockConfig = {
        id: "cfg-1",
        key: "test-key",
        value: "value",
        encrypted: null,
        category: null,
        schema: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: now,
        updatedAt: now,
        createdBy: "user1",
        updatedBy: null,
      };

      mockDb.systemConfig.findUnique.mockResolvedValue(mockConfig);
      mockDb.systemConfig.update.mockResolvedValue({ ...mockConfig, isActive: false });

      const result = await service.delete("test-key", "user2");

      expect(result).toBe(true);
      expect(mockDb.systemConfig.update).toHaveBeenCalledWith({
        where: { key: "test-key" },
        data: { isActive: false, updatedBy: "user2" },
      });
    });

    it("returns false when config missing", async () => {
      mockDb.systemConfig.findUnique.mockResolvedValue(null);

      const result = await service.delete("missing-key");

      expect(result).toBe(false);
      expect(mockDb.systemConfig.update).not.toHaveBeenCalled();
    });
  });

  describe("seedFromEnvironment", () => {
    it("seeds missing configs using set", async () => {
      process.env.SMTP_URL = "smtp://localhost:1025";
      process.env.SMTP_FROM = "test@example.com";

      mockDb.systemConfig.findUnique
        .mockImplementationOnce(async () => null) // validate schema
        .mockImplementationOnce(async () => null) // first upsert existing check
        .mockImplementationOnce(async () => null) // validate schema second
        .mockImplementationOnce(async () => null); // second upsert check

      mockDb.systemConfig.upsert.mockResolvedValue({
        id: "cfg",
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
      });

      await service.seedFromEnvironment(
        {
          SMTP_URL: { category: "email", isSecret: true },
          SMTP_FROM: { category: "email", isSecret: false },
        },
        "system",
      );

      expect(mockDb.systemConfig.upsert).toHaveBeenCalledTimes(2);

      const firstCall = mockDb.systemConfig.upsert.mock.calls[0][0];
      expect(firstCall.create.schema).toBeDefined();
      expect(firstCall.create.metadata).toMatchObject({ source: "environment_seed" });

      delete process.env.SMTP_URL;
      delete process.env.SMTP_FROM;
    });
  });
});
