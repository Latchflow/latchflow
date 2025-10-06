import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const setCredentialsMock = vi.fn();
const getAccessTokenMock = vi.fn(async () => "access-token");

vi.mock("google-auth-library", () => {
  return {
    OAuth2Client: class MockOAuth2Client {
      clientId: string;
      clientSecret: string;
      constructor(clientId: string, clientSecret: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
      }
      setCredentials = setCredentialsMock;
      getAccessToken = getAccessTokenMock;
    },
  };
});

import plugin from "../index.js";

describe("gmail provider integration", () => {
  const register = vi.fn(async (_ctx, provider) => provider);
  const unregister = vi.fn(async () => {});
  const setActiveProvider = vi.fn(async () => {});
  const logger = {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };

  const emailProviders = {
    register,
    unregister,
    setActiveProvider,
  };

  const services = {
    core: { emailProviders },
  } as const;

  const pluginContext = { name: plugin.name };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.restoreAllMocks();
    register.mockClear();
    unregister.mockClear();
    setActiveProvider.mockClear();
    logger.warn.mockClear();
    setCredentialsMock.mockClear();
    getAccessTokenMock.mockClear();
    fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ id: "gmail-msg" }),
      text: async () => "",
    }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await plugin.dispose();
  });

  it("registers provider and sends mail via Gmail API", async () => {
    const config = {
      providerId: "gmail-primary",
      displayName: "Gmail Primary",
      clientId: "client-id",
      clientSecret: "client-secret",
      refreshToken: "refresh-token",
      sender: "sender@example.com",
      makeDefault: true,
    };

    await plugin.providers[0].register({ services, plugin: pluginContext, config, logger });

    expect(register).toHaveBeenCalledTimes(1);
    const registration = register.mock.calls[0][1];
    expect(registration).toMatchObject({
      id: "gmail-primary",
      displayName: "Gmail Primary",
      capabilityId: `${plugin.name}:email`,
    });
    expect(typeof registration.send).toBe("function");
    expect(setActiveProvider).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: ["email:send"] }),
      "gmail-primary",
    );

    const sendResult = await registration.send({
      to: [{ address: "user@example.com" }],
      subject: "Testing",
      textBody: "Hello",
    });

    expect(setCredentialsMock).toHaveBeenCalledWith({ refresh_token: "refresh-token" });
    expect(getAccessTokenMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ Authorization: "Bearer access-token" }),
      }),
    );
    expect(sendResult).toEqual({
      providerMessageId: "gmail-msg",
      acceptedRecipients: [{ address: "user@example.com" }],
      rawResponse: { id: "gmail-msg" },
    });

    await plugin.dispose();
    expect(unregister).toHaveBeenCalledWith(
      expect.objectContaining({ requestedScopes: ["email:send"] }),
      "gmail-primary",
    );
  });

  it("skips registration when secrets are missing", async () => {
    const config = {
      providerId: "gmail",
      displayName: "Gmail",
      clientId: "__CHANGE_ME__",
      clientSecret: "__CHANGE_ME__",
      refreshToken: "__CHANGE_ME__",
      sender: "change-me@example.com",
      makeDefault: true,
    };

    await plugin.providers[0].register({ services, plugin: pluginContext, config, logger });

    expect(register).not.toHaveBeenCalled();
    expect(setActiveProvider).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({ missing: expect.arrayContaining(["clientId", "clientSecret"]) }),
      expect.stringContaining("configuration incomplete"),
    );
  });
});
