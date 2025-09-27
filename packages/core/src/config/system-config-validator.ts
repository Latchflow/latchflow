import type { SystemConfigValue } from "./types.js";

export class SystemConfigValidator {
  async validateSchema(
    configValue: SystemConfigValue | null,
    value: unknown,
    schemaOverride?: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    const schema = schemaOverride ?? configValue?.schema ?? null;
    return this.validateWithSchema(schema, value);
  }

  async validateWithSchema(
    schema: unknown,
    value: unknown,
  ): Promise<{ valid: boolean; errors?: string[] }> {
    if (schema == null) {
      return { valid: true };
    }

    if (typeof schema !== "object" || Array.isArray(schema)) {
      return {
        valid: false,
        errors: ["Invalid schema definition"],
      };
    }

    try {
      const schemaRecord = schema as Record<string, unknown>;

      if (schemaRecord.type) {
        const valueType = typeof value;

        if (schemaRecord.type === "string" && valueType !== "string") {
          return { valid: false, errors: [`Expected string, got ${valueType}`] };
        }

        if (schemaRecord.type === "number" && valueType !== "number") {
          return { valid: false, errors: [`Expected number, got ${valueType}`] };
        }

        if (schemaRecord.type === "boolean" && valueType !== "boolean") {
          return { valid: false, errors: [`Expected boolean, got ${valueType}`] };
        }

        if (
          schemaRecord.type === "object" &&
          (valueType !== "object" || value === null || Array.isArray(value))
        ) {
          return { valid: false, errors: [`Expected object, got ${valueType}`] };
        }

        if (schemaRecord.type === "array" && !Array.isArray(value)) {
          return { valid: false, errors: [`Expected array, got ${valueType}`] };
        }
      }

      if (schemaRecord.type === "string" && typeof value === "string") {
        if (typeof schemaRecord.minLength === "number" && value.length < schemaRecord.minLength) {
          return {
            valid: false,
            errors: [`String too short, minimum length is ${schemaRecord.minLength}`],
          };
        }

        if (typeof schemaRecord.maxLength === "number" && value.length > schemaRecord.maxLength) {
          return {
            valid: false,
            errors: [`String too long, maximum length is ${schemaRecord.maxLength}`],
          };
        }

        if (
          typeof schemaRecord.pattern === "string" &&
          !new RegExp(schemaRecord.pattern).test(value)
        ) {
          return {
            valid: false,
            errors: [`String does not match pattern: ${schemaRecord.pattern}`],
          };
        }
      }

      if (schemaRecord.type === "number" && typeof value === "number") {
        if (typeof schemaRecord.minimum === "number" && value < schemaRecord.minimum) {
          return { valid: false, errors: [`Number too small, minimum is ${schemaRecord.minimum}`] };
        }

        if (typeof schemaRecord.maximum === "number" && value > schemaRecord.maximum) {
          return { valid: false, errors: [`Number too large, maximum is ${schemaRecord.maximum}`] };
        }
      }

      if (Array.isArray(schemaRecord.enum) && !schemaRecord.enum.includes(value)) {
        return {
          valid: false,
          errors: [`Value must be one of: ${schemaRecord.enum.join(", ")}`],
        };
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
