import type { SystemConfigValue } from "./types.js";

export class SystemConfigValidator {
  async validateSchema(
    configValue: SystemConfigValue | null,
    value: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    if (!configValue?.schema) {
      return { valid: true };
    }

    try {
      // Basic validation for common types
      const schema = configValue.schema as Record<string, unknown>;

      if (schema.type) {
        const valueType = typeof value;

        if (schema.type === "string" && valueType !== "string") {
          return { valid: false, errors: [`Expected string, got ${valueType}`] };
        }

        if (schema.type === "number" && valueType !== "number") {
          return { valid: false, errors: [`Expected number, got ${valueType}`] };
        }

        if (schema.type === "boolean" && valueType !== "boolean") {
          return { valid: false, errors: [`Expected boolean, got ${valueType}`] };
        }

        if (
          schema.type === "object" &&
          (valueType !== "object" || value === null || Array.isArray(value))
        ) {
          return { valid: false, errors: [`Expected object, got ${valueType}`] };
        }

        if (schema.type === "array" && !Array.isArray(value)) {
          return { valid: false, errors: [`Expected array, got ${valueType}`] };
        }
      }

      // String validation
      if (schema.type === "string" && typeof value === "string") {
        if (typeof schema.minLength === "number" && value.length < schema.minLength) {
          return {
            valid: false,
            errors: [`String too short, minimum length is ${schema.minLength}`],
          };
        }

        if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
          return {
            valid: false,
            errors: [`String too long, maximum length is ${schema.maxLength}`],
          };
        }

        if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
          return { valid: false, errors: [`String does not match pattern: ${schema.pattern}`] };
        }
      }

      // Number validation
      if (schema.type === "number" && typeof value === "number") {
        if (typeof schema.minimum === "number" && value < schema.minimum) {
          return { valid: false, errors: [`Number too small, minimum is ${schema.minimum}`] };
        }

        if (typeof schema.maximum === "number" && value > schema.maximum) {
          return { valid: false, errors: [`Number too large, maximum is ${schema.maximum}`] };
        }
      }

      // Enum validation
      if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
        return { valid: false, errors: [`Value must be one of: ${schema.enum.join(", ")}`] };
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        errors: [(error as Error).message],
      };
    }
  }

  static validateEmailConfiguration(
    key: string,
    value: unknown,
  ): { valid: boolean; errors?: string[] } {
    if (key === "SMTP_URL" && typeof value === "string") {
      try {
        const url = new URL(value);
        if (!["smtp", "smtps"].includes(url.protocol.replace(":", ""))) {
          return {
            valid: false,
            errors: ["SMTP URL must use smtp:// or smtps:// protocol"],
          };
        }
      } catch {
        return {
          valid: false,
          errors: ["Invalid SMTP URL format"],
        };
      }
    }

    if (key === "SMTP_FROM" && typeof value === "string") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(value)) {
        return {
          valid: false,
          errors: ["SMTP_FROM must be a valid email address"],
        };
      }
    }

    return { valid: true };
  }
}
