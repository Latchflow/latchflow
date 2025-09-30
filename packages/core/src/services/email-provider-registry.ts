import type { Buffer } from "node:buffer";
import type { PluginServiceContext } from "./context.js";

export interface EmailRecipient {
  address: string;
  displayName?: string;
}

export interface EmailAttachment {
  filename: string;
  contentType: string;
  content: Buffer | Uint8Array | string;
  contentId?: string;
  inline?: boolean;
}

export interface EmailHeaders {
  [header: string]: string;
}

export interface EmailSendRequest {
  to: EmailRecipient[];
  cc?: EmailRecipient[];
  bcc?: EmailRecipient[];
  replyTo?: EmailRecipient;
  subject: string;
  textBody?: string;
  htmlBody?: string;
  attachments?: EmailAttachment[];
  headers?: EmailHeaders;
  metadata?: Record<string, unknown>;
}

export interface EmailSendResult {
  providerMessageId?: string;
  acceptedRecipients?: EmailRecipient[];
  rejectedRecipients?: EmailRecipient[];
  deliveredAt?: Date;
  rawResponse?: unknown;
}

export interface EmailProviderContext {
  capabilityId: string;
  pluginName: string;
  definitionId?: string;
  invocationId?: string;
}

export type EmailSendHandler = (
  request: EmailSendRequest,
  context: EmailProviderContext,
) => Promise<EmailSendResult | void>;

export interface EmailProviderRegistration {
  id: string;
  capabilityId: string;
  displayName: string;
  send: EmailSendHandler;
}

export interface EmailProviderRegistry {
  register(context: PluginServiceContext, provider: EmailProviderRegistration): void;
  unregister(context: PluginServiceContext, providerId: string): void;
  getProvider(providerId: string): EmailProviderRegistration | undefined;
  getActiveProvider(): EmailProviderRegistration | undefined;
  setActiveProvider(context: PluginServiceContext, providerId: string): void;
  listProviders(): EmailProviderRegistration[];
}
