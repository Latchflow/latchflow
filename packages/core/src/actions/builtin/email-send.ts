import { z } from "zod";
import type { EmailDeliveryService } from "../../email/delivery-service.js";
import type { ActionFactory, ActionExecutionInput } from "../../plugins/contracts.js";
import type { EmailSendRequest, EmailRecipient } from "../../services/email-provider-registry.js";

export const EMAIL_SEND_JSON_SCHEMA = {
  type: "object",
  properties: {
    to: recipientArraySchema(),
    cc: recipientArraySchema({ required: false }),
    bcc: recipientArraySchema({ required: false }),
    subject: { type: "string", minLength: 1 },
    textBody: { type: "string" },
    htmlBody: { type: "string" },
    from: recipientSchema({ allowArray: false }),
    replyTo: recipientSchema({ allowArray: false }),
    headers: {
      type: "object",
      additionalProperties: { type: "string" },
    },
  },
  required: ["to", "subject"],
  additionalProperties: false,
} as const;

type RecipientInput = string | { address: string; displayName?: string | null };

type EmailConfig = z.infer<typeof emailConfigSchema>;

type EmailOverrides = z.infer<typeof emailOverridesSchema>;

const recipientInputSchema = z.union([
  z.string().min(1, "Email address is required"),
  z.object({
    address: z.string().min(1, "Email address is required"),
    displayName: z.string().optional(),
  }),
]);

const recipientArrayInputSchema = z.array(recipientInputSchema);

const emailConfigSchema = z.object({
  to: recipientArrayInputSchema.min(1, "At least one recipient is required"),
  cc: recipientArrayInputSchema.optional(),
  bcc: recipientArrayInputSchema.optional(),
  subject: z.string().min(1, "Subject is required"),
  textBody: z.string().optional(),
  htmlBody: z.string().optional(),
  from: recipientInputSchema.optional(),
  replyTo: recipientInputSchema.optional(),
  headers: z.record(z.string()).optional(),
});

const emailOverridesSchema = emailConfigSchema.partial();

export function createEmailSendActionFactory(deps: {
  emailService: EmailDeliveryService;
}): ActionFactory {
  return async () => {
    return {
      async execute(input: ActionExecutionInput) {
        const request = buildEmailRequest(input);
        const result = await deps.emailService.sendEmail(request);
        return { output: result };
      },
    };
  };
}

function buildEmailRequest(input: ActionExecutionInput): EmailSendRequest {
  const base = emailConfigSchema.safeParse(input.config ?? {});
  if (!base.success) {
    throw base.error;
  }

  const overrides = emailOverridesSchema.safeParse(input.payload ?? {});
  if (!overrides.success) {
    throw overrides.error;
  }

  const merged = mergeEmailConfig(base.data, overrides.data);
  return normalizeEmailConfig(merged);
}

function mergeEmailConfig(base: EmailConfig, overrides: EmailOverrides): EmailConfig {
  const merged: EmailConfig = {
    ...base,
    to: overrides.to ?? base.to,
    cc: overrides.cc ?? base.cc,
    bcc: overrides.bcc ?? base.bcc,
    subject: overrides.subject ?? base.subject,
    textBody: overrides.textBody ?? base.textBody,
    htmlBody: overrides.htmlBody ?? base.htmlBody,
    from: overrides.from ?? base.from,
    replyTo: overrides.replyTo ?? base.replyTo,
    headers: overrides.headers ?? base.headers,
  };

  if (!merged.to || merged.to.length === 0) {
    throw new Error("Email requires at least one recipient");
  }

  if (!merged.textBody && !merged.htmlBody) {
    throw new Error("Either textBody or htmlBody must be provided");
  }

  return merged;
}

function normalizeEmailConfig(config: EmailConfig): EmailSendRequest {
  return {
    to: normalizeRecipientArray(config.to, "to"),
    cc: config.cc ? normalizeRecipientArray(config.cc, "cc") : undefined,
    bcc: config.bcc ? normalizeRecipientArray(config.bcc, "bcc") : undefined,
    subject: config.subject.trim(),
    textBody: config.textBody?.trim(),
    htmlBody: config.htmlBody?.trim(),
    from: config.from ? normalizeRecipient(config.from, "from") : undefined,
    replyTo: config.replyTo ? normalizeRecipient(config.replyTo, "replyTo") : undefined,
    headers: normalizeHeaders(config.headers),
  } satisfies EmailSendRequest;
}

function normalizeRecipientArray(values: RecipientInput[], label: string): EmailRecipient[] {
  const recipients = values.map((value) => normalizeRecipient(value, label));
  if (recipients.length === 0) {
    throw new Error(`Email requires at least one ${label} recipient`);
  }
  return recipients;
}

function normalizeRecipient(value: RecipientInput, label: string): EmailRecipient {
  if (typeof value === "string") {
    return parseRecipientString(value, label);
  }

  const address = value.address.trim();
  if (!address) {
    throw new Error(`${label} recipient address cannot be empty`);
  }
  validateEmailAddress(address, label);
  const displayName = value.displayName?.trim();
  return displayName ? { address, displayName } : { address };
}

function parseRecipientString(raw: string, label: string): EmailRecipient {
  const value = raw.trim();
  if (!value) {
    throw new Error(`${label} recipient must be a non-empty string`);
  }

  const angleMatch = value.match(/^([^<]*)<([^>]+)>$/);
  if (angleMatch) {
    const displayName = angleMatch[1].trim();
    const address = angleMatch[2].trim();
    validateEmailAddress(address, label);
    return displayName ? { address, displayName } : { address };
  }

  validateEmailAddress(value, label);
  return { address: value };
}

function validateEmailAddress(address: string, label: string) {
  if (!address.includes("@") || address.startsWith("@") || address.endsWith("@")) {
    throw new Error(`${label} recipient must include a valid email address`);
  }
}

function normalizeHeaders(
  headers: Record<string, string> | undefined,
): Record<string, string> | undefined {
  if (!headers) return undefined;
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    if (typeof value !== "string") {
      throw new Error(`Header '${key}' must be a string`);
    }
    const trimmedKey = key.trim();
    if (!trimmedKey) {
      throw new Error("Header names cannot be empty");
    }
    result[trimmedKey] = value;
  }
  return result;
}

function recipientSchema(options: { allowArray: boolean }) {
  const schema = {
    anyOf: [
      { type: "string" },
      {
        type: "object",
        properties: {
          address: { type: "string" },
          displayName: { type: "string" },
        },
        required: ["address"],
        additionalProperties: false,
      },
    ],
  } as const;

  if (options.allowArray) {
    return {
      anyOf: [
        schema,
        {
          type: "array",
          items: schema.anyOf,
        },
      ],
    } as const;
  }

  return schema;
}

function recipientArraySchema(options: { required?: boolean } = { required: true }) {
  return {
    type: "array",
    items: recipientSchema({ allowArray: false }).anyOf,
    minItems: options.required === false ? undefined : 1,
  } as const;
}
