import type { AppConfig } from "../config/config.js";
import type { ActorType as PrismaActorType } from "@latchflow/db";

export type ActorType = PrismaActorType;

export type ActorContext =
  | { actorType: "USER"; actorUserId: string; onBehalfOfUserId?: string | null }
  | {
      actorType: "ACTION";
      actorInvocationId?: string | null;
      actorActionDefinitionId?: string | null;
      onBehalfOfUserId?: string | null;
    }
  | { actorType: "SYSTEM" };

export function resolveEffectiveUserId(
  cfg: Pick<AppConfig, "SYSTEM_USER_ID">,
  actor: ActorContext,
): string {
  if (actor.actorType === "USER") return actor.actorUserId;
  if (actor.actorType === "ACTION") return actor.onBehalfOfUserId ?? cfg.SYSTEM_USER_ID;
  return cfg.SYSTEM_USER_ID;
}

export function toPrismaActorFields(actor: ActorContext): {
  actorType: PrismaActorType;
  actorUserId: string | null;
  actorInvocationId: string | null;
  actorActionDefinitionId: string | null;
  onBehalfOfUserId: string | null;
} {
  if (actor.actorType === "USER") {
    return {
      actorType: "USER",
      actorUserId: actor.actorUserId,
      actorInvocationId: null,
      actorActionDefinitionId: null,
      onBehalfOfUserId: actor.onBehalfOfUserId ?? null,
    };
  }
  if (actor.actorType === "ACTION") {
    return {
      actorType: "ACTION",
      actorUserId: null,
      actorInvocationId: actor.actorInvocationId ?? null,
      actorActionDefinitionId: actor.actorActionDefinitionId ?? null,
      onBehalfOfUserId: actor.onBehalfOfUserId ?? null,
    };
  }
  return {
    actorType: "SYSTEM",
    actorUserId: null,
    actorInvocationId: null,
    actorActionDefinitionId: null,
    onBehalfOfUserId: null,
  };
}
