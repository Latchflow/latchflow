import type { Prisma } from "@latchflow/db";
import type { DbClient } from "../db/db.js";
import type { PluginRuntimeRegistry } from "./plugin-loader.js";
import type { ActionCapability, ActionFactory } from "./contracts.js";
import {
  createEmailSendActionFactory,
  EMAIL_SEND_JSON_SCHEMA,
} from "../actions/builtin/email-send.js";
import type { EmailDeliveryService } from "../email/delivery-service.js";

export const CORE_SYSTEM_PLUGIN_ID = "core-system-plugin";
export const CORE_SYSTEM_PLUGIN_NAME = "@latchflow/core";
export const EMAIL_SEND_CAPABILITY_KEY = "email.send";
export const EMAIL_SEND_DISPLAY_NAME = "Send Email";

export type CoreBuiltinCapabilityIds = {
  emailSendId: string;
};

const EMAIL_SEND_CAPABILITY: ActionCapability = {
  kind: "ACTION",
  key: EMAIL_SEND_CAPABILITY_KEY,
  displayName: EMAIL_SEND_DISPLAY_NAME,
  configSchema: EMAIL_SEND_JSON_SCHEMA,
};

export async function ensureCoreBuiltins(db: DbClient): Promise<CoreBuiltinCapabilityIds> {
  const pluginRow = await db.plugin.upsert({
    where: { id: CORE_SYSTEM_PLUGIN_ID },
    update: {
      name: CORE_SYSTEM_PLUGIN_NAME,
      description: "Core system plugin for built-in actions",
    },
    create: {
      id: CORE_SYSTEM_PLUGIN_ID,
      name: CORE_SYSTEM_PLUGIN_NAME,
      description: "Core system plugin for built-in actions",
    },
  });

  const emailCapability = await db.pluginCapability.upsert({
    where: {
      pluginId_key: { pluginId: pluginRow.id, key: EMAIL_SEND_CAPABILITY_KEY },
    },
    update: {
      displayName: EMAIL_SEND_DISPLAY_NAME,
      jsonSchema: EMAIL_SEND_JSON_SCHEMA as unknown as Prisma.InputJsonValue,
      isEnabled: true,
    },
    create: {
      pluginId: pluginRow.id,
      kind: "ACTION",
      key: EMAIL_SEND_CAPABILITY_KEY,
      displayName: EMAIL_SEND_DISPLAY_NAME,
      jsonSchema: EMAIL_SEND_JSON_SCHEMA as unknown as Prisma.InputJsonValue,
    },
  });

  return { emailSendId: emailCapability.id };
}

export function registerCoreBuiltinActions(
  runtime: PluginRuntimeRegistry,
  deps: { emailCapabilityId: string; emailService: EmailDeliveryService },
) {
  if (runtime.getActionById(deps.emailCapabilityId)) {
    return;
  }

  const factory: ActionFactory = createEmailSendActionFactory({ emailService: deps.emailService });

  runtime.registerAction({
    pluginName: CORE_SYSTEM_PLUGIN_NAME,
    pluginId: CORE_SYSTEM_PLUGIN_ID,
    capabilityId: deps.emailCapabilityId,
    capability: EMAIL_SEND_CAPABILITY,
    factory,
  });
}
