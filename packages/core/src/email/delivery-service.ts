import nodemailer from "nodemailer";
import type SMTPTransport from "nodemailer/lib/smtp-transport";
import type { AppConfig } from "../config/env-config.js";
import type { SystemConfigService } from "../config/system-config-core.js";
import {
  type EmailProviderRegistry,
  type EmailSendRequest,
  type EmailSendResult,
} from "../services/email-provider-registry.js";
import { buildSmtpTransportOptions } from "./smtp.js";
import { createPluginLogger } from "../observability/logger.js";

const emailLogger = createPluginLogger("email-delivery");

export interface EmailDeliveryResult {
  delivered: boolean;
  providerId?: string;
  raw?: EmailSendResult | null;
}

type ConfigResolver = Pick<SystemConfigService, "get">;

type Dependencies = {
  registry: EmailProviderRegistry;
  systemConfig: ConfigResolver;
  config: AppConfig;
};

export class EmailDeliveryService {
  private readonly registry: EmailProviderRegistry;
  private readonly systemConfig: ConfigResolver;
  private readonly config: AppConfig;

  constructor(deps: Dependencies) {
    this.registry = deps.registry;
    this.systemConfig = deps.systemConfig;
    this.config = deps.config;
  }

  async sendEmail(request: EmailSendRequest): Promise<EmailDeliveryResult> {
    const normalized = normalizeRequest(request);

    const activeProvider = this.registry.getActiveProvider();
    if (activeProvider) {
      try {
        const result =
          (await activeProvider.send(normalized, {
            capabilityId: activeProvider.capabilityId,
            pluginName: activeProvider.pluginName,
          })) ?? null;
        emailLogger.info(
          { providerId: activeProvider.id, pluginName: activeProvider.pluginName },
          "Email delivered via plugin provider",
        );
        return { delivered: true, providerId: activeProvider.id, raw: result };
      } catch (error) {
        emailLogger.warn(
          {
            providerId: activeProvider.id,
            pluginName: activeProvider.pluginName,
            error: (error as Error).message,
          },
          "Plugin email provider failed; attempting SMTP fallback",
        );
      }
    }

    const smtpUrl = await this.resolveConfigValue("SMTP_URL");
    if (!smtpUrl) {
      throw new Error("No email provider available and SMTP is not configured");
    }

    const transporter = nodemailer.createTransport(
      buildSmtpTransportOptions(smtpUrl),
    ) as nodemailer.Transporter<SMTPTransport.SentMessageInfo>;

    try {
      await transporter.sendMail(toNodemailerMessage(normalized, await this.resolveFromAddress()));
      emailLogger.info({ transport: "smtp" }, "Email delivered via SMTP fallback");
      return { delivered: true };
    } finally {
      transporter.close();
    }
  }

  private async resolveFromAddress(): Promise<string> {
    const configFrom = await this.resolveConfigValue("SMTP_FROM");
    if (configFrom && configFrom.trim().length > 0) {
      return configFrom.trim();
    }
    return this.config.SMTP_FROM?.trim() || "no-reply@latchflow.local";
  }

  private async resolveConfigValue(key: "SMTP_URL" | "SMTP_FROM"): Promise<string | null> {
    try {
      const record = await this.systemConfig.get(key);
      if (typeof record?.value === "string" && record.value.trim().length > 0) {
        return record.value.trim();
      }
    } catch (error) {
      emailLogger.warn({ key, error: (error as Error).message }, "Failed to resolve system config");
    }

    const fallback = this.config[key]?.trim();
    return fallback && fallback.length > 0 ? fallback : null;
  }
}

function normalizeRequest(request: EmailSendRequest): EmailSendRequest {
  if (!request.subject || request.subject.trim().length === 0) {
    throw new Error("Email subject is required");
  }
  if (!Array.isArray(request.to) || request.to.length === 0) {
    throw new Error("Email requires at least one recipient");
  }
  return {
    ...request,
    to: request.to.map(normalizeRecipient),
    cc: request.cc?.map(normalizeRecipient),
    bcc: request.bcc?.map(normalizeRecipient),
    replyTo: request.replyTo ? normalizeRecipient(request.replyTo) : undefined,
    from: request.from ? normalizeRecipient(request.from) : undefined,
  };
}

function normalizeRecipient(
  recipient: EmailSendRequest["to"][number],
): EmailSendRequest["to"][number] {
  const address = recipient.address.trim();
  if (!address) {
    throw new Error("Email recipient address is required");
  }
  const displayName = recipient.displayName?.trim();
  return displayName ? { address, displayName } : { address };
}

function toNodemailerMessage(request: EmailSendRequest, fallbackFrom: string) {
  const fromAddress = request.from ? formatRecipient(request.from) : fallbackFrom;

  return {
    from: fromAddress,
    to: request.to.map(formatRecipient).join(", "),
    cc:
      request.cc && request.cc.length > 0 ? request.cc.map(formatRecipient).join(", ") : undefined,
    bcc:
      request.bcc && request.bcc.length > 0
        ? request.bcc.map(formatRecipient).join(", ")
        : undefined,
    subject: request.subject,
    text: request.textBody,
    html: request.htmlBody,
    replyTo: request.replyTo ? formatRecipient(request.replyTo) : undefined,
    headers: request.headers,
    attachments: request.attachments?.map((attachment) => {
      const content =
        typeof attachment.content === "string" || Buffer.isBuffer(attachment.content)
          ? attachment.content
          : Buffer.from(attachment.content);
      return {
        filename: attachment.filename,
        content,
        contentType: attachment.contentType,
        cid: attachment.contentId,
        disposition: attachment.inline ? "inline" : undefined,
      };
    }),
  } satisfies nodemailer.SendMailOptions;
}

function formatRecipient(recipient: EmailSendRequest["to"][number]): string {
  return recipient.displayName
    ? `${recipient.displayName} <${recipient.address}>`
    : recipient.address;
}
