import type { Buffer } from "node:buffer";

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
  register(provider: EmailProviderRegistration): void;
  unregister(providerId: string): void;
  getProvider(providerId: string): EmailProviderRegistration | undefined;
  getActiveProvider(): EmailProviderRegistration | undefined;
  setActiveProvider(providerId: string): void;
  listProviders(): EmailProviderRegistration[];
}
