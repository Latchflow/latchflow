import { describe, it, expect, beforeEach } from "vitest";
import { SystemConfigValidator } from "./system-config-validator.js";
import type { SystemConfigValue } from "./types.js";

describe("SystemConfigValidator", () => {
  let validator: SystemConfigValidator;

  beforeEach(() => {
    validator = new SystemConfigValidator();
  });

  describe("validateSchema", () => {
    it("should return valid when no schema defined", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: "test-value",
        schema: null,
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const result = await validator.validateSchema(config, "any-value");
      expect(result).toEqual({ valid: true });
    });

    it("should validate string type", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: "current-value",
        schema: { type: "string" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validResult = await validator.validateSchema(config, "string-value");
      expect(validResult).toEqual({ valid: true });

      const invalidResult = await validator.validateSchema(config, 123);
      expect(invalidResult).toEqual({
        valid: false,
        errors: ["Expected string, got number"],
      });
    });

    it("should validate string length constraints", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: "current-value",
        schema: { type: "string", minLength: 5, maxLength: 10 },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const tooShort = await validator.validateSchema(config, "hi");
      expect(tooShort).toEqual({
        valid: false,
        errors: ["String too short, minimum length is 5"],
      });

      const tooLong = await validator.validateSchema(config, "this is way too long");
      expect(tooLong).toEqual({
        valid: false,
        errors: ["String too long, maximum length is 10"],
      });

      const justRight = await validator.validateSchema(config, "perfect");
      expect(justRight).toEqual({ valid: true });
    });

    it("should validate string pattern", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: "current-value",
        schema: { type: "string", pattern: "^[a-z]+$" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validPattern = await validator.validateSchema(config, "lowercase");
      expect(validPattern).toEqual({ valid: true });

      const invalidPattern = await validator.validateSchema(config, "HasUpperCase");
      expect(invalidPattern).toEqual({
        valid: false,
        errors: ["String does not match pattern: ^[a-z]+$"],
      });
    });

    it("should validate number type and constraints", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: 5,
        schema: { type: "number", minimum: 1, maximum: 10 },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validNumber = await validator.validateSchema(config, 5);
      expect(validNumber).toEqual({ valid: true });

      const tooSmall = await validator.validateSchema(config, 0);
      expect(tooSmall).toEqual({
        valid: false,
        errors: ["Number too small, minimum is 1"],
      });

      const tooLarge = await validator.validateSchema(config, 15);
      expect(tooLarge).toEqual({
        valid: false,
        errors: ["Number too large, maximum is 10"],
      });

      const wrongType = await validator.validateSchema(config, "not-a-number");
      expect(wrongType).toEqual({
        valid: false,
        errors: ["Expected number, got string"],
      });
    });

    it("should validate boolean type", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: true,
        schema: { type: "boolean" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validBoolean = await validator.validateSchema(config, false);
      expect(validBoolean).toEqual({ valid: true });

      const invalidBoolean = await validator.validateSchema(config, "true");
      expect(invalidBoolean).toEqual({
        valid: false,
        errors: ["Expected boolean, got string"],
      });
    });

    it("should validate object type", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: {},
        schema: { type: "object" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validObject = await validator.validateSchema(config, { key: "value" });
      expect(validObject).toEqual({ valid: true });

      const invalidNull = await validator.validateSchema(config, null);
      expect(invalidNull).toEqual({
        valid: false,
        errors: ["Expected object, got object"],
      });

      const invalidArray = await validator.validateSchema(config, []);
      expect(invalidArray).toEqual({
        valid: false,
        errors: ["Expected object, got object"],
      });
    });

    it("should validate array type", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: [],
        schema: { type: "array" },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validArray = await validator.validateSchema(config, [1, 2, 3]);
      expect(validArray).toEqual({ valid: true });

      const invalidObject = await validator.validateSchema(config, {});
      expect(invalidObject).toEqual({
        valid: false,
        errors: ["Expected array, got object"],
      });
    });

    it("should validate enum values", async () => {
      const config: SystemConfigValue = {
        key: "test-key",
        value: "option1",
        schema: { enum: ["option1", "option2", "option3"] },
        category: null,
        metadata: null,
        isSecret: false,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        createdBy: null,
        updatedBy: null,
        source: "database",
      };

      const validEnum = await validator.validateSchema(config, "option2");
      expect(validEnum).toEqual({ valid: true });

      const invalidEnum = await validator.validateSchema(config, "invalid-option");
      expect(invalidEnum).toEqual({
        valid: false,
        errors: ["Value must be one of: option1, option2, option3"],
      });
    });
  });

  describe("validateEmailConfiguration", () => {
    it("should validate SMTP URL format", () => {
      const validSmtp = SystemConfigValidator.validateEmailConfiguration(
        "SMTP_URL",
        "smtp://test.server.com:587",
      );
      expect(validSmtp).toEqual({ valid: true });

      const validSmtps = SystemConfigValidator.validateEmailConfiguration(
        "SMTP_URL",
        "smtps://test.server.com:465",
      );
      expect(validSmtps).toEqual({ valid: true });

      const invalidProtocol = SystemConfigValidator.validateEmailConfiguration(
        "SMTP_URL",
        "http://test.server.com",
      );
      expect(invalidProtocol).toEqual({
        valid: false,
        errors: ["SMTP URL must use smtp:// or smtps:// protocol"],
      });

      const invalidUrl = SystemConfigValidator.validateEmailConfiguration("SMTP_URL", "not-a-url");
      expect(invalidUrl).toEqual({
        valid: false,
        errors: ["Invalid SMTP URL format"],
      });
    });

    it("should validate SMTP_FROM email format", () => {
      const validEmail = SystemConfigValidator.validateEmailConfiguration(
        "SMTP_FROM",
        "test@example.com",
      );
      expect(validEmail).toEqual({ valid: true });

      const invalidEmail = SystemConfigValidator.validateEmailConfiguration(
        "SMTP_FROM",
        "not-an-email",
      );
      expect(invalidEmail).toEqual({
        valid: false,
        errors: ["SMTP_FROM must be a valid email address"],
      });

      const emptyEmail = SystemConfigValidator.validateEmailConfiguration("SMTP_FROM", "");
      expect(emptyEmail).toEqual({
        valid: false,
        errors: ["SMTP_FROM must be a valid email address"],
      });
    });

    it("should return valid for non-email keys", () => {
      const result = SystemConfigValidator.validateEmailConfiguration("OTHER_KEY", "any-value");
      expect(result).toEqual({ valid: true });
    });

    it("should handle non-string values gracefully", () => {
      const result = SystemConfigValidator.validateEmailConfiguration("SMTP_URL", 123);
      expect(result).toEqual({ valid: true });
    });
  });
});
