import { describe, expect, it, vi } from "vitest";
import { createEmailSendActionFactory } from "./email-send.js";
import type { EmailDeliveryService } from "../../email/delivery-service.js";
import type { ActionRuntimeContext, ActionRuntimeServices } from "../../plugins/contracts.js";

function createRuntimeContext(): ActionRuntimeContext {
  const services: ActionRuntimeServices = {
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
    core: {} as unknown as ActionRuntimeServices["core"],
  };

  return {
    definitionId: "def-1",
    capability: {
      kind: "ACTION",
      key: "email.send",
      displayName: "Send Email",
      configSchema: undefined,
    },
    plugin: { name: "@latchflow/core" },
    services,
  };
}

describe("email.send built-in action", () => {
  it("sends email using merged config and payload", async () => {
    const sendEmail = vi
      .fn()
      .mockResolvedValue({ delivered: true, providerId: "provider", raw: null });
    const emailService = { sendEmail } as unknown as EmailDeliveryService;
    const factory = createEmailSendActionFactory({ emailService });
    const runtime = await factory(createRuntimeContext());

    const result = await runtime.execute({
      config: {
        to: ["User <base@example.com>"],
        subject: "Base Subject",
      },
      payload: {
        to: ["override@example.com"],
        subject: "Override",
        textBody: "Dynamic text",
        htmlBody: "<p>Hello</p>",
      },
      secrets: null,
      invocation: { invocationId: "inv-1" },
    });

    expect(sendEmail).toHaveBeenCalledTimes(1);
    expect(sendEmail).toHaveBeenCalledWith({
      to: [{ address: "override@example.com" }],
      subject: "Override",
      textBody: "Dynamic text",
      htmlBody: "<p>Hello</p>",
      cc: undefined,
      bcc: undefined,
      from: undefined,
      replyTo: undefined,
      headers: undefined,
    });
    expect(result).toEqual({
      output: { delivered: true, providerId: "provider", raw: null },
    });
  });

  it("throws when no recipients are provided", async () => {
    const sendEmail = vi.fn();
    const emailService = { sendEmail } as unknown as EmailDeliveryService;
    const factory = createEmailSendActionFactory({ emailService });
    const runtime = await factory(createRuntimeContext());

    await expect(
      runtime.execute({
        config: {
          to: ["someone@example.com"],
          subject: "Missing override",
          textBody: "body",
        },
        payload: {
          to: [],
        },
        secrets: null,
        invocation: { invocationId: "inv-2" },
      }),
    ).rejects.toThrowError("At least one recipient is required");
  });
});
