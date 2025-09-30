import { LatchflowQueue } from "../queue/types.js";
import { getDb } from "../db/db.js";
import type { Prisma, $Enums } from "@latchflow/db";
import type { PluginRuntimeRegistry } from "../plugins/plugin-loader.js";
import type { ActionRuntimeContext } from "../plugins/contracts.js";
import { createPluginLogger } from "../observability/logger.js";
import { PluginServiceError } from "../services/errors.js";
import { decryptConfig } from "../plugins/config-encryption.js";
import { recordPluginActionAudit } from "../audit/plugin-audit.js";
import type { PluginServiceRuntimeContextInit } from "../services/plugin-services.js";

const ACTION_EXECUTION_TIMEOUT_MS = 60_000;
const runnerLogger = createPluginLogger("action-runner");
const DEFAULT_RETRY_DELAY_MS = 2_000;
const MAX_RETRY_DELAY_MS = 60_000;
const ACTION_CONCURRENCY_LIMIT = Math.max(1, Number(process.env.PLUGIN_ACTION_CONCURRENCY ?? 10));

const slotWaiters: (() => void)[] = [];
let inFlightActions = 0;

async function acquireActionSlot(): Promise<void> {
  if (inFlightActions < ACTION_CONCURRENCY_LIMIT) {
    inFlightActions += 1;
    return;
  }
  await new Promise<void>((resolve) => {
    slotWaiters.push(resolve);
  });
  inFlightActions += 1;
}

function releaseActionSlot() {
  inFlightActions = Math.max(0, inFlightActions - 1);
  const next = slotWaiters.shift();
  if (next) next();
}

type QueueMessage = {
  actionDefinitionId: string;
  triggerEventId?: string;
  manualInvokerId?: string;
  context?: Record<string, unknown>;
  attempt?: number;
};

export async function startActionConsumer(
  queue: LatchflowQueue,
  deps: {
    registry: PluginRuntimeRegistry;
    encryption: import("../plugins/config-encryption.js").ConfigEncryptionOptions;
  },
) {
  const db = getDb();
  await queue.consumeActions(async (msg: QueueMessage) => {
    const invocation = await db.actionInvocation.create({
      data: {
        actionDefinitionId: msg.actionDefinitionId,
        triggerEventId: msg.triggerEventId ?? null,
        manualInvokerId: msg.manualInvokerId ?? null,
        status: "PENDING",
      },
    });

    const finishInvocation = async (data: Prisma.ActionInvocationUpdateInput): Promise<void> => {
      await db.actionInvocation.update({
        where: { id: invocation.id },
        data,
      });
    };

    const attempt = msg.attempt ?? 1;
    let pluginName: string | undefined;
    let capabilityKey: string | undefined;

    try {
      const definition = await db.actionDefinition.findUnique({
        where: { id: msg.actionDefinitionId },
        select: {
          id: true,
          capabilityId: true,
          config: true,
          isEnabled: true,
        },
      });

      if (!definition || definition.isEnabled === false) {
        await finishInvocation({
          status: "SKIPPED_DISABLED",
          result: { reason: "ACTION_DISABLED" } as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          retryAt: null,
        });
        return;
      }

      const ref = deps.registry.requireActionById(definition.capabilityId);
      pluginName = ref.pluginName;
      capabilityKey = ref.capability.key;
      const logger = createPluginLogger(ref.pluginName);
      const baseContext: PluginServiceRuntimeContextInit = {
        pluginName: ref.pluginName,
        pluginId: ref.pluginId,
        capabilityId: ref.capabilityId,
        capabilityKey: ref.capability.key,
        executionKind: "action",
        definitionId: definition.id,
        invocationId: invocation.id,
        triggerEventId: msg.triggerEventId,
        manualInvokerId: msg.manualInvokerId,
      };
      const services = deps.registry.createRuntimeServices(baseContext);
      const decryptedConfig = decryptConfig(definition.config, deps.encryption);

      await recordPluginActionAudit({
        timestamp: new Date(),
        pluginName: ref.pluginName,
        capabilityKey: ref.capability.key,
        actionDefinitionId: definition.id,
        invocationId: invocation.id,
        triggerEventId: msg.triggerEventId,
        phase: "STARTED",
        attempt,
      });

      const context: ActionRuntimeContext = {
        definitionId: definition.id,
        capability: ref.capability,
        plugin: { name: ref.pluginName },
        services,
      };

      const runtime = await ref.factory(context);
      await acquireActionSlot();
      let slotReleased = false;
      const release = () => {
        if (!slotReleased) {
          slotReleased = true;
          releaseActionSlot();
        }
      };
      try {
        const executionResult = await executeWithTimeout(
          runtime.execute({
            config: decryptedConfig,
            secrets: null,
            payload: msg.context,
            invocation: {
              invocationId: invocation.id,
              triggerEventId: msg.triggerEventId,
              manualInvokerId: msg.manualInvokerId,
              context: msg.context,
            },
          }),
          ACTION_EXECUTION_TIMEOUT_MS,
          ref.pluginName,
          definition.id,
        );

        if (executionResult && executionResult.retry) {
          const retryDelay = Math.max(
            0,
            executionResult.retry.delayMs ?? computeBackoffDelay(attempt),
          );
          await finishInvocation({
            status: "RETRYING",
            result: (executionResult ?? null) as unknown as Prisma.InputJsonValue,
            completedAt: new Date(),
            retryAt: retryDelay > 0 ? new Date(Date.now() + retryDelay) : null,
          });
          await recordPluginActionAudit({
            timestamp: new Date(),
            pluginName: ref.pluginName,
            capabilityKey: ref.capability.key,
            actionDefinitionId: definition.id,
            invocationId: invocation.id,
            triggerEventId: msg.triggerEventId,
            phase: "RETRY",
            retryDelayMs: retryDelay,
            attempt,
          });
          scheduleRetry(queue, msg, retryDelay, attempt + 1);
          return;
        }

        await finishInvocation({
          status: "SUCCESS",
          result: (executionResult ?? null) as unknown as Prisma.InputJsonValue,
          completedAt: new Date(),
          retryAt: null,
        });
        await recordPluginActionAudit({
          timestamp: new Date(),
          pluginName: ref.pluginName,
          capabilityKey: ref.capability.key,
          actionDefinitionId: definition.id,
          invocationId: invocation.id,
          triggerEventId: msg.triggerEventId,
          phase: "SUCCEEDED",
          attempt,
        });
      } finally {
        if (typeof runtime.dispose === "function") {
          try {
            await runtime.dispose();
          } catch (err) {
            logger.warn(
              { error: (err as Error).message, actionDefinitionId: definition.id },
              "Action runtime dispose failed",
            );
          }
        }
        release();
      }
    } catch (e) {
      const error = e as Error;
      let status: $Enums.InvocationStatus = "FAILED";
      let retryDelay = 0;
      if (error instanceof PluginServiceError) {
        if (error.kind === "RETRYABLE" || error.kind === "RATE_LIMIT") {
          status = "RETRYING";
          retryDelay = Math.max(0, error.retryDelayMs ?? computeBackoffDelay(attempt));
        } else if (error.kind === "PERMISSION" || error.kind === "VALIDATION") {
          status = "FAILED_PERMANENT";
        } else if (error.kind === "FATAL") {
          status = "FAILED_PERMANENT";
        }
      }

      await finishInvocation({
        status,
        result: { error: error.message } as unknown as Prisma.InputJsonValue,
        completedAt: new Date(),
        retryAt: status === "RETRYING" && retryDelay > 0 ? new Date(Date.now() + retryDelay) : null,
      });
      await recordPluginActionAudit({
        timestamp: new Date(),
        pluginName: pluginName ?? "unknown",
        capabilityKey: capabilityKey ?? "unknown",
        actionDefinitionId: msg.actionDefinitionId,
        invocationId: invocation.id,
        triggerEventId: msg.triggerEventId,
        phase: status === "RETRYING" ? "RETRY" : "FAILED",
        errorCode: error instanceof PluginServiceError ? error.code : undefined,
        errorKind: error instanceof PluginServiceError ? error.kind : "UNKNOWN",
        retryDelayMs: status === "RETRYING" ? retryDelay : undefined,
        message: error.message,
        attempt,
      });

      if (status === "RETRYING") {
        scheduleRetry(queue, msg, retryDelay, attempt + 1);
      } else if (!(error instanceof PluginServiceError)) {
        runnerLogger.warn(
          {
            error: error.message,
            actionDefinitionId: msg.actionDefinitionId,
          },
          "Action execution failed",
        );
      }
    }
  });
}

function scheduleRetry(
  queue: LatchflowQueue,
  msg: QueueMessage,
  delayMs: number,
  nextAttempt: number,
) {
  const payload: QueueMessage = {
    actionDefinitionId: msg.actionDefinitionId,
    triggerEventId: msg.triggerEventId,
    manualInvokerId: msg.manualInvokerId,
    context: msg.context,
    attempt: nextAttempt,
  };
  setTimeout(
    () => {
      queue
        .enqueueAction(payload)
        .catch((err) => runnerLogger.warn({ error: err.message }, "Failed to enqueue retry"));
    },
    Math.max(0, delayMs),
  );
}

function computeBackoffDelay(attempt: number): number {
  const delay = DEFAULT_RETRY_DELAY_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(delay, MAX_RETRY_DELAY_MS);
}

async function executeWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  pluginName: string,
  actionDefinitionId: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeoutError = new PluginServiceError({
    kind: "FATAL",
    code: "ACTION_TIMEOUT",
    message: `Action ${actionDefinitionId} from plugin ${pluginName} timed out after ${timeoutMs}ms`,
  });

  return new Promise<T>((resolve, reject) => {
    timer = setTimeout(() => {
      reject(timeoutError);
    }, timeoutMs);

    promise
      .then((value) => {
        if (timer) clearTimeout(timer);
        resolve(value);
      })
      .catch((err) => {
        if (timer) clearTimeout(timer);
        reject(err);
      });
  });
}
