import { createHash } from "crypto";
import type { DbClient } from "../db/db.js";
import type { AppConfig } from "../config/config.js";
import type { ActorContext } from "./actor.js";
import { toPrismaActorFields } from "./actor.js";
import { serializeAggregate, canonicalStringify, type EntityType } from "./canonical.js";
import { applyPatch, computePatch, type JsonPatchOp } from "./patch.js";
import type { ChangeKind as PrismaChangeKind, Prisma } from "@latchflow/db";

type ChangeLogDbClient = DbClient | Prisma.TransactionClient;

export async function materializeVersion(
  db: ChangeLogDbClient,
  entityType: EntityType,
  entityId: string,
  version: number,
): Promise<Record<string, unknown> | null> {
  const rows = await db.changeLog.findMany({
    where: { entityType, entityId, version: { lte: version } },
    orderBy: { version: "asc" },
  });
  if (!rows.length) return null;
  let state: unknown = null;
  for (const row of rows) {
    if (row.isSnapshot) state = row.state as unknown;
    else state = applyPatch(state, row.diff as unknown as JsonPatchOp[]);
  }
  return state as Record<string, unknown>;
}

export async function appendChangeLog(
  db: ChangeLogDbClient,
  cfg: Pick<AppConfig, "HISTORY_SNAPSHOT_INTERVAL" | "HISTORY_MAX_CHAIN_DEPTH">,
  entityType: EntityType,
  entityId: string,
  actor: ActorContext,
  opts?: {
    changeNote?: string | null;
    changedPath?: string | null;
    changeKind?: PrismaChangeKind | null;
  },
) {
  const latest = await db.changeLog.findFirst({
    where: { entityType, entityId },
    orderBy: { version: "desc" },
  });
  const nextVersion = latest ? latest.version + 1 : 1;
  const newState = await serializeAggregate(db, entityType, entityId);
  if (!newState)
    throw new Error(`appendChangeLog: missing aggregate for ${entityType} ${entityId}`);

  const shouldSnapshot =
    nextVersion === 1 || (nextVersion - 1) % cfg.HISTORY_SNAPSHOT_INTERVAL === 0;

  let isSnapshot = shouldSnapshot;
  let diff: JsonPatchOp[] | null = null;
  if (!isSnapshot) {
    const prev = await materializeVersion(db, entityType, entityId, nextVersion - 1);
    if (!prev) {
      isSnapshot = true;
    } else {
      // Force snapshot if chain depth too large
      const chainDepth = await db.changeLog.count({
        where: { entityType, entityId, isSnapshot: false },
      });
      if (chainDepth >= cfg.HISTORY_MAX_CHAIN_DEPTH) isSnapshot = true;
      else diff = computePatch(prev, newState);
    }
  }

  const postStateString = canonicalStringify(newState);
  const hash = createHash("sha256").update(postStateString).digest("hex");
  const actorFields = toPrismaActorFields(actor);

  const row = await db.changeLog.create({
    data: {
      entityType,
      entityId,
      version: nextVersion,
      isSnapshot,
      state: isSnapshot ? (newState as Prisma.InputJsonValue) : undefined,
      diff: !isSnapshot ? (diff as unknown as Prisma.InputJsonValue) : undefined,
      hash,
      actorType: actorFields.actorType,
      actorUserId: actorFields.actorUserId,
      actorInvocationId: actorFields.actorInvocationId,
      actorActionDefinitionId: actorFields.actorActionDefinitionId,
      onBehalfOfUserId: actorFields.onBehalfOfUserId,
      changeNote: opts?.changeNote ?? null,
      changedPath: opts?.changedPath ?? null,
      changeKind: opts?.changeKind ?? null,
    },
  });
  return row;
}
