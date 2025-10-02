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
  from?: EmailRecipient;
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
  getProvider(providerId: string): RegisteredEmailProvider | undefined;
  getActiveProvider(): RegisteredEmailProvider | undefined;
  setActiveProvider(context: PluginServiceContext, providerId: string): void;
  listProviders(): RegisteredEmailProvider[];
}

export interface RegisteredEmailProvider extends EmailProviderRegistration {
  pluginName: string;
  registeredAt: Date;
  updatedAt: Date;
}

export class InMemoryEmailProviderRegistry implements EmailProviderRegistry {
  private readonly providers = new Map<string, RegisteredEmailProvider>();
  private activeProviderId: string | null = null;

  register(context: PluginServiceContext, provider: EmailProviderRegistration): void {
    if (!provider || typeof provider !== "object") {
      throw new Error("Email provider registration must be an object");
    }
    const { id, capabilityId, displayName, send } = provider;
    if (!id || typeof id !== "string") {
      throw new Error("Email provider id is required");
    }
    if (!capabilityId || typeof capabilityId !== "string") {
      throw new Error("Email provider capabilityId is required");
    }
    if (!displayName || typeof displayName !== "string") {
      throw new Error("Email provider displayName is required");
    }
    if (typeof send !== "function") {
      throw new Error("Email provider send handler must be a function");
    }

    const now = new Date();
    const existing = this.providers.get(id);
    const record: RegisteredEmailProvider = {
      ...provider,
      pluginName: context.pluginName,
      registeredAt: existing?.registeredAt ?? now,
      updatedAt: now,
    };

    this.providers.set(id, record);
    if (!this.activeProviderId) {
      this.activeProviderId = id;
    }
  }

  unregister(context: PluginServiceContext, providerId: string): void {
    if (!providerId || typeof providerId !== "string") {
      throw new Error("Email provider id is required to unregister");
    }
    const entry = this.providers.get(providerId);
    if (!entry) return;
    if (entry.pluginName !== context.pluginName) {
      throw new Error("Email provider can only be unregistered by its owning plugin");
    }

    this.providers.delete(providerId);
    if (this.activeProviderId === providerId) {
      this.activeProviderId = this.providers.size > 0 ? this.providers.keys().next().value : null;
    }
  }

  getProvider(providerId: string): RegisteredEmailProvider | undefined {
    return this.providers.get(providerId);
  }

  getActiveProvider(): RegisteredEmailProvider | undefined {
    if (!this.activeProviderId) return undefined;
    return this.providers.get(this.activeProviderId);
  }

  setActiveProvider(_context: PluginServiceContext, providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Unknown email provider: ${providerId}`);
    }
    this.activeProviderId = providerId;
  }

  listProviders(): RegisteredEmailProvider[] {
    return Array.from(this.providers.values()).sort(
      (a, b) => a.registeredAt.getTime() - b.registeredAt.getTime(),
    );
  }
}
