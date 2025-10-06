import { describe, it, expect, beforeAll, vi } from "vitest";
import { EmailDeliveryService } from "../../src/email/delivery-service.js";
import { InMemoryEmailProviderRegistry } from "../../src/services/email-provider-registry.js";
import { createStubPluginServiceRegistry } from "../../src/services/stubs.js";
import { PluginRuntimeRegistry } from "../../src/plugins/plugin-loader.js";
import { ensureCoreBuiltins, registerCoreBuiltinActions } from "../../src/plugins/core-plugin.js";
import { createMemoryQueue } from "../../src/queue/memory-queue.js";
import { startActionConsumer } from "../../src/runtime/action-runner.js";
import { startTriggerRunner } from "../../src/runtime/trigger-runner.js";
import { getEnv } from "@tests/helpers/containers";

describe("E2E: cron → Gmail workflow", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("fires cron trigger, executes built-in email action via Gmail provider, and records success", async () => {
    const emailRegistry = new InMemoryEmailProviderRegistry();
    const pluginServices = createStubPluginServiceRegistry({ emailRegistry });
    const runtime = new PluginRuntimeRegistry(pluginServices);

    const emailService = new EmailDeliveryService({
      registry: emailRegistry,
      systemConfig: { get: async () => null },
      config: {
        SMTP_URL: null,
        SMTP_FROM: "no-reply@latchflow.local",
      } as any,
    });

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.workflow.admin@example.com" },
      update: {},
      create: { email: "e2e.workflow.admin@example.com", role: "ADMIN" as any },
    });

    const { emailSendId } = await ensureCoreBuiltins(prisma);
    registerCoreBuiltinActions(runtime, {
      emailCapabilityId: emailSendId,
      emailService,
    });

    // Register a mock email provider instead of using the real Gmail plugin
    const mockSend = vi.fn(async (request) => ({
      providerMessageId: "mock-gmail-msg-id",
      acceptedRecipients: request.to,
      rawResponse: { id: "mock-gmail-msg-id" },
    }));

    await emailRegistry.register(
      { requestedScopes: ["email:send"] },
      {
        id: "mock-gmail-provider",
        capabilityId: "test:email",
        displayName: "Mock Gmail Provider",
        send: mockSend,
      },
    );

    await emailRegistry.setActiveProvider(
      { requestedScopes: ["email:send"] },
      "mock-gmail-provider",
    );

    const activeProvider = emailRegistry.getActiveProvider();
    expect(activeProvider?.id).toBe("mock-gmail-provider");

    const queue = await createMemoryQueue({ config: null });
    let actionConsumerReady = false;
    await startActionConsumer(queue, {
      registry: runtime,
      encryption: { mode: "none" },
    }).then(() => {
      actionConsumerReady = true;
    });

    await vi.waitFor(() => {
      expect(actionConsumerReady).toBe(true);
    });

    const runner = await startTriggerRunner({
      onFire: async (msg) => queue.enqueueAction(msg),
    });

    const cronPlugin = await prisma.plugin.create({ data: { name: `e2e_cron_${Date.now()}` } });
    const triggerCapability = await prisma.pluginCapability.create({
      data: {
        pluginId: cronPlugin.id,
        kind: "TRIGGER",
        key: "cron_schedule",
        displayName: "Cron",
        jsonSchema: { type: "object" },
        isEnabled: true,
      },
    });

    const triggerDefinition = await prisma.triggerDefinition.create({
      data: {
        name: "Cron Trigger",
        capabilityId: triggerCapability.id,
        config: { mode: "cron", cron: { expression: "* * * * *" } } as any,
        isEnabled: true,
        createdBy: admin.id,
      },
    });

    const actionDefinition = await prisma.actionDefinition.create({
      data: {
        name: "Send Email",
        capabilityId: emailSendId,
        config: {
          to: ["base@example.com"],
          subject: "Base",
          textBody: "Base body",
        },
        isEnabled: true,
        createdBy: admin.id,
      },
    });

    const pipeline = await prisma.pipeline.create({
      data: { name: `pipe_${Date.now()}`, isEnabled: true, createdBy: admin.id },
    });

    await prisma.pipelineStep.create({
      data: {
        pipelineId: pipeline.id,
        actionId: actionDefinition.id,
        sortOrder: 1,
        isEnabled: true,
        createdBy: admin.id,
      },
    });

    await prisma.pipelineTrigger.create({
      data: {
        pipelineId: pipeline.id,
        triggerId: triggerDefinition.id,
        sortOrder: 1,
        isEnabled: true,
        createdBy: admin.id,
      },
    });

    const cleanup = async () => {
      await prisma.actionInvocation.deleteMany({
        where: { actionDefinitionId: actionDefinition.id },
      });
      await prisma.triggerEvent.deleteMany({
        where: { triggerDefinitionId: triggerDefinition.id },
      });
      await prisma.pipelineStep.deleteMany({ where: { pipelineId: pipeline.id } });
      await prisma.pipelineTrigger.deleteMany({ where: { pipelineId: pipeline.id } });
      await prisma.pipeline.delete({ where: { id: pipeline.id } });
      await prisma.actionDefinition.delete({ where: { id: actionDefinition.id } });
      await prisma.triggerDefinition.delete({ where: { id: triggerDefinition.id } });
      await prisma.pluginCapability.delete({ where: { id: triggerCapability.id } });
      await prisma.plugin.delete({ where: { id: cronPlugin.id } });
    };

    try {
      const eventId = await runner.fireTriggerOnce(triggerDefinition.id, {
        context: {
          to: [{ address: "recipient@example.com" }],
          subject: "Cron Fired",
          textBody: "Dynamic body",
        },
      });

      // Wait for the mock email provider to be called
      await vi.waitFor(
        () => {
          expect(mockSend).toHaveBeenCalled();
        },
        { timeout: 15_000 },
      );

      // Verify the action invocation succeeded
      await vi.waitFor(
        async () => {
          const invocation = await prisma.actionInvocation.findFirst({
            where: { triggerEventId: eventId },
            orderBy: { startedAt: "desc" },
          });
          expect(invocation?.status).toBe("SUCCESS");
        },
        { timeout: 10_000 },
      );

      // Verify the email provider was called with correct parameters
      expect(mockSend).toHaveBeenCalledTimes(1);
      const emailRequest = mockSend.mock.calls[0][0];
      expect(emailRequest.subject).toBe("Cron Fired");
      expect(emailRequest.to).toEqual([{ address: "recipient@example.com" }]);
      expect(emailRequest.textBody).toBe("Dynamic body");
    } finally {
      await queue.stop();
      await cleanup();
    }
  });
});
