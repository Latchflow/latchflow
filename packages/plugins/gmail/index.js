import { OAuth2Client } from "google-auth-library";

const EMAIL_SEND_SCOPE = "email:send";
const SECRET_PLACEHOLDER = "__CHANGE_ME__";
const SENDER_PLACEHOLDER = "change-me@example.com";
let unregisterProvider = null;

function envValue(key, fallback) {
  const value = process.env[key];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function buildDefaults() {
  return {
    providerId: envValue("GMAIL_PROVIDER_ID", "gmail"),
    displayName: envValue("GMAIL_DISPLAY_NAME", "Gmail"),
    makeDefault:
      process.env.GMAIL_MAKE_DEFAULT === undefined
        ? true
        : process.env.GMAIL_MAKE_DEFAULT !== "false",
    clientId: envValue("GMAIL_CLIENT_ID", SECRET_PLACEHOLDER),
    clientSecret: envValue("GMAIL_CLIENT_SECRET", SECRET_PLACEHOLDER),
    refreshToken: envValue("GMAIL_REFRESH_TOKEN", SECRET_PLACEHOLDER),
    sender: envValue("GMAIL_SENDER", SENDER_PLACEHOLDER),
  };
}

function slugify(value) {
  return value
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function providerConfigKey(pluginName, providerId) {
  return `PLUGIN_${slugify(pluginName)}_PROVIDER_${slugify(providerId)}`;
}

function hasMissingSecrets(config) {
  const missing = [];
  if (!config.clientId || config.clientId === SECRET_PLACEHOLDER) missing.push("clientId");
  if (!config.clientSecret || config.clientSecret === SECRET_PLACEHOLDER)
    missing.push("clientSecret");
  if (!config.refreshToken || config.refreshToken === SECRET_PLACEHOLDER)
    missing.push("refreshToken");
  if (!config.sender || config.sender === SENDER_PLACEHOLDER) missing.push("sender");
  return missing;
}

function formatRecipient(recipient) {
  return recipient.displayName
    ? `${recipient.displayName} <${recipient.address}>`
    : recipient.address;
}

function buildMimeMessage(request, defaultSender) {
  const headers = [];
  const fromAddress = request.from ? formatRecipient(request.from) : defaultSender;
  headers.push(`From: ${fromAddress}`);
  headers.push(`To: ${request.to.map(formatRecipient).join(", ")}`);
  if (request.cc?.length) headers.push(`Cc: ${request.cc.map(formatRecipient).join(", ")}`);
  if (request.bcc?.length) headers.push(`Bcc: ${request.bcc.map(formatRecipient).join(", ")}`);
  headers.push("MIME-Version: 1.0");
  headers.push(`Subject: ${request.subject}`);

  let body = "";
  if (request.textBody && request.htmlBody) {
    const boundary = `gmail_boundary_${Date.now()}`;
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = `--${boundary}\r\nContent-Type: text/plain; charset="UTF-8"\r\n\r\n${request.textBody}\r\n\r\n--${boundary}\r\nContent-Type: text/html; charset="UTF-8"\r\n\r\n${request.htmlBody}\r\n\r\n--${boundary}--`;
  } else if (request.htmlBody) {
    headers.push('Content-Type: text/html; charset="UTF-8"');
    body = request.htmlBody;
  } else {
    headers.push('Content-Type: text/plain; charset="UTF-8"');
    body = request.textBody ?? "";
  }

  if (request.headers) {
    for (const [key, value] of Object.entries(request.headers)) {
      if (typeof value === "string") {
        headers.push(`${key}: ${value}`);
      }
    }
  }

  if (request.attachments?.length) {
    throw new Error("Gmail provider does not yet support attachments");
  }

  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

function toBase64Url(value) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function sendViaGmail(config, request) {
  const client = new OAuth2Client(config.clientId, config.clientSecret);
  client.setCredentials({ refresh_token: config.refreshToken });
  const accessTokenResponse = await client.getAccessToken();
  const accessToken =
    typeof accessTokenResponse === "string" ? accessTokenResponse : accessTokenResponse?.token;
  if (!accessToken) {
    throw new Error("Gmail provider failed to obtain access token");
  }

  const message = buildMimeMessage(request, config.sender);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw: toBase64Url(message) }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Gmail API error (${response.status}): ${text}`);
  }

  const payload = await response.json();
  return {
    providerMessageId: payload.id,
    acceptedRecipients: request.to,
    rawResponse: payload,
  };
}

const gmailProviderDescriptor = {
  kind: "email",
  id: "gmail",
  displayName: "Gmail",
  configSchema: {
    type: "object",
    properties: {
      providerId: { type: "string" },
      displayName: { type: "string" },
      clientId: { type: "string" },
      clientSecret: { type: "string" },
      refreshToken: { type: "string" },
      sender: { type: "string", pattern: "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$" },
      makeDefault: { type: "boolean" },
    },
    required: ["providerId", "clientId", "clientSecret", "refreshToken", "sender"],
    additionalProperties: false,
  },
  defaults: buildDefaults(),
  async register({ services, plugin, config, logger }) {
    const normalized = {
      providerId: config.providerId || "gmail",
      displayName: config.displayName || "Gmail",
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: config.refreshToken,
      sender: config.sender,
      makeDefault: config.makeDefault !== false,
    };

    const missing = hasMissingSecrets(normalized);
    if (missing.length > 0) {
      logger.warn(
        {
          missing,
          systemConfigKey: providerConfigKey(plugin.name, normalized.providerId),
        },
        "Gmail provider configuration incomplete; skipping registration",
      );
      unregisterProvider = null;
      return;
    }

    await services.core.emailProviders.register(
      { requestedScopes: [EMAIL_SEND_SCOPE] },
      {
        id: normalized.providerId,
        capabilityId: `${plugin.name}:email`,
        displayName: normalized.displayName,
        send: async (request) => sendViaGmail(normalized, request),
      },
    );

    if (normalized.makeDefault) {
      await services.core.emailProviders.setActiveProvider(
        { requestedScopes: [EMAIL_SEND_SCOPE] },
        normalized.providerId,
      );
    }

    unregisterProvider = async () => {
      try {
        await services.core.emailProviders.unregister(
          { requestedScopes: [EMAIL_SEND_SCOPE] },
          normalized.providerId,
        );
      } catch (err) {
        logger?.warn?.(
          { error: err instanceof Error ? err.message : err },
          "Failed to unregister Gmail provider",
        );
      }
    };
  },
};

const plugin = {
  name: "@latchflow/plugin-gmail",
  capabilities: [],
  providers: [gmailProviderDescriptor],
  async dispose() {
    if (typeof unregisterProvider === "function") {
      await unregisterProvider();
      unregisterProvider = null;
    }
  },
};

export default plugin;
