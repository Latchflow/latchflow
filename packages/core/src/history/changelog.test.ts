import { describe, it, expect, beforeEach } from "vitest";

import { appendChangeLog, materializeVersion } from "./changelog.js";
import type { ActorContext } from "./actor.js";

// Shared prisma mock from test setup
import { prisma as db } from "@latchflow/db";

function resetDb() {
  const models = Object.values(db as any) as any[];
  for (const m of models) {
    for (const k of Object.keys(m)) {
      const fn = (m as any)[k];
      if (fn && typeof fn.mockReset === "function") fn.mockReset();
    }
  }
}

const cfg = { HISTORY_SNAPSHOT_INTERVAL: 5, HISTORY_MAX_CHAIN_DEPTH: 3 } as const;

describe("history/changelog", () => {
  beforeEach(() => {
    resetDb();
  });

  describe("materializeVersion", () => {
    it("replays snapshot and diffs in order", async () => {
      // v1 snapshot -> {a:1}
      // v2 replace root -> {b:2}
      // v3 replace root -> {c:3}
      db.changeLog.findMany
        .mockResolvedValueOnce([{ version: 1, isSnapshot: true, state: { a: 1 }, diff: null }])
        .mockResolvedValueOnce([
          { version: 1, isSnapshot: true, state: { a: 1 }, diff: null },
          {
            version: 2,
            isSnapshot: false,
            state: null,
            diff: [{ op: "replace", path: "/", value: { b: 2 } }],
          },
        ])
        .mockResolvedValueOnce([
          { version: 1, isSnapshot: true, state: { a: 1 }, diff: null },
          {
            version: 2,
            isSnapshot: false,
            state: null,
            diff: [{ op: "replace", path: "/", value: { b: 2 } }],
          },
          {
            version: 3,
            isSnapshot: false,
            state: null,
            diff: [{ op: "replace", path: "/", value: { c: 3 } }],
          },
        ]);

      const v1 = await materializeVersion(db as any, "RECIPIENT", "r1", 1);
      expect(v1).toEqual({ a: 1 });

      const v2 = await materializeVersion(db as any, "RECIPIENT", "r1", 2);
      expect(v2).toEqual({ b: 2 });

      const v3 = await materializeVersion(db as any, "RECIPIENT", "r1", 3);
      expect(v3).toEqual({ c: 3 });
    });

    it("returns null when no rows", async () => {
      db.changeLog.findMany.mockResolvedValueOnce([]);
      const v = await materializeVersion(db as any, "RECIPIENT", "r1", 1);
      expect(v).toBeNull();
    });
  });

  describe("appendChangeLog", () => {
    const actor: ActorContext = { actorType: "USER", actorUserId: "u1" };

    it("creates initial snapshot at version 1", async () => {
      db.changeLog.findFirst.mockResolvedValueOnce(null); // no previous versions
      db.recipient.findUnique.mockResolvedValueOnce({
        id: "r1",
        email: "e@x",
        name: null,
        createdBy: "u1",
        updatedBy: null,
      });
      db.changeLog.create.mockResolvedValueOnce({ id: "row1", version: 1 });

      const row = await appendChangeLog(db as any, cfg, "RECIPIENT", "r1", actor);

      expect(db.changeLog.create).toHaveBeenCalledTimes(1);
      const arg = db.changeLog.create.mock.calls[0][0].data;
      expect(arg.version).toBe(1);
      expect(arg.isSnapshot).toBe(true);
      expect(arg.state).toEqual({
        id: "r1",
        email: "e@x",
        name: null,
        createdBy: "u1",
        updatedBy: null,
      });
      expect(arg.diff).toBeUndefined();
      expect(arg.actorType).toBe("USER");
      expect(arg.actorUserId).toBe("u1");
      expect(typeof arg.hash).toBe("string");
      expect(arg.hash.length).toBe(64); // sha256 hex
      expect(row).toEqual({ id: "row1", version: 1 });
    });

    it("creates diff when previous exists and chain depth ok", async () => {
      db.changeLog.findFirst.mockResolvedValueOnce({ version: 1 });
      // Reconstruct previous state for version 1
      db.changeLog.findMany.mockResolvedValueOnce([
        { version: 1, isSnapshot: true, state: { id: "r1", email: "old@x" }, diff: null },
      ]);
      // Current aggregate differs
      db.recipient.findUnique.mockResolvedValueOnce({
        id: "r1",
        email: "new@x",
        createdBy: "u1",
        updatedBy: "u2",
        name: null,
      });
      // Chain depth small
      db.changeLog.count.mockResolvedValueOnce(1);
      db.changeLog.create.mockResolvedValueOnce({ id: "row2", version: 2 });

      const row = await appendChangeLog(
        db as any,
        { ...cfg, HISTORY_SNAPSHOT_INTERVAL: 10 },
        "RECIPIENT",
        "r1",
        actor,
        { changeNote: "email updated", changedPath: "/email", changeKind: "UPDATE" as any },
      );

      const arg = db.changeLog.create.mock.calls[0][0].data;
      expect(arg.version).toBe(2);
      expect(arg.isSnapshot).toBe(false);
      expect(arg.diff).toEqual([
        {
          op: "replace",
          path: "/",
          value: { id: "r1", email: "new@x", name: null, createdBy: "u1", updatedBy: "u2" },
        },
      ]);
      expect(arg.state).toBeUndefined();
      expect(arg.changeNote).toBe("email updated");
      expect(arg.changedPath).toBe("/email");
      expect(arg.changeKind).toBe("UPDATE");
      expect(row).toEqual({ id: "row2", version: 2 });
    });

    it("forces snapshot when chain depth exceeds limit", async () => {
      db.changeLog.findFirst.mockResolvedValueOnce({ version: 3 });
      db.changeLog.findMany.mockResolvedValueOnce([
        { version: 1, isSnapshot: true, state: { a: 1 }, diff: null },
        {
          version: 2,
          isSnapshot: false,
          state: null,
          diff: [{ op: "replace", path: "/", value: { a: 2 } }],
        },
        {
          version: 3,
          isSnapshot: false,
          state: null,
          diff: [{ op: "replace", path: "/", value: { a: 3 } }],
        },
      ]);
      db.recipient.findUnique.mockResolvedValueOnce({
        id: "r1",
        email: "x@y",
        name: null,
        createdBy: "sys",
        updatedBy: null,
      });
      // chainDepth >= max -> force snapshot
      db.changeLog.count.mockResolvedValueOnce(3);
      db.changeLog.create.mockResolvedValueOnce({ id: "row4", version: 4 });

      await appendChangeLog(db as any, cfg, "RECIPIENT", "r1", actor);

      const arg = db.changeLog.create.mock.calls[0][0].data;
      expect(arg.version).toBe(4);
      expect(arg.isSnapshot).toBe(true);
      expect(arg.state).toEqual({
        id: "r1",
        email: "x@y",
        name: null,
        createdBy: "sys",
        updatedBy: null,
      });
      expect(arg.diff).toBeUndefined();
    });

    it("forces snapshot when previous materialization is missing", async () => {
      db.changeLog.findFirst.mockResolvedValueOnce({ version: 2 });
      // materializeVersion -> no rows
      db.changeLog.findMany.mockResolvedValueOnce([]);
      db.recipient.findUnique.mockResolvedValueOnce({
        id: "r1",
        email: "x@y",
        name: null,
        createdBy: "sys",
        updatedBy: null,
      });
      db.changeLog.create.mockResolvedValueOnce({ id: "row3", version: 3 });

      await appendChangeLog(db as any, cfg, "RECIPIENT", "r1", actor);
      const arg = db.changeLog.create.mock.calls[0][0].data;
      expect(arg.version).toBe(3);
      expect(arg.isSnapshot).toBe(true);
      expect(arg.state).toEqual({
        id: "r1",
        email: "x@y",
        name: null,
        createdBy: "sys",
        updatedBy: null,
      });
    });

    it("throws when aggregate is missing", async () => {
      db.changeLog.findFirst.mockResolvedValueOnce(null);
      db.recipient.findUnique.mockResolvedValueOnce(null);
      await expect(appendChangeLog(db as any, cfg, "RECIPIENT", "missing", actor)).rejects.toThrow(
        /missing aggregate/i,
      );
    });
  });
});
