import { describe, it, expect, beforeEach } from "vitest";

import { canonicalStringify, serializeAggregate } from "./canonical.js";

// Access the shared prisma mock from test setup
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

describe("history/canonical", () => {
  beforeEach(() => {
    resetDb();
  });

  describe("canonicalStringify", () => {
    it("sorts object keys deeply and preserves arrays", () => {
      const input = {
        b: 2,
        a: { y: 2, x: 1 },
        arr: [{ z: 1, a: 2 }, { b: 1 }],
      } as const;
      const out = canonicalStringify(input);
      expect(out).toBe(
        JSON.stringify({
          a: { x: 1, y: 2 },
          arr: [{ a: 2, z: 1 }, { b: 1 }],
          b: 2,
        }),
      );
    });
  });

  describe("serializeAggregate", () => {
    it("serializes PIPELINE with sorted steps and triggers", async () => {
      db.pipeline.findUnique.mockResolvedValueOnce({
        id: "p1",
        name: "Pipe",
        description: null,
        isEnabled: true,
        createdBy: "u1",
        updatedBy: null,
        steps: [
          { id: "s2", actionId: "a2", sortOrder: 2, isEnabled: false },
          { id: "s1", actionId: "a1", sortOrder: 1, isEnabled: true },
        ],
        triggers: [
          { triggerId: "t2", sortOrder: 20, isEnabled: true },
          { triggerId: "t1", sortOrder: 10, isEnabled: false },
        ],
      });
      const got = await serializeAggregate(db as any, "PIPELINE", "p1");
      expect(got).toEqual({
        id: "p1",
        name: "Pipe",
        description: null,
        isEnabled: true,
        steps: [
          { id: "s1", actionId: "a1", sortOrder: 1, isEnabled: true },
          { id: "s2", actionId: "a2", sortOrder: 2, isEnabled: false },
        ],
        triggers: [
          { triggerId: "t1", sortOrder: 10, isEnabled: false },
          { triggerId: "t2", sortOrder: 20, isEnabled: true },
        ],
        createdBy: "u1",
        updatedBy: null,
      });
    });

    it("serializes BUNDLE with sorted objects and assignments", async () => {
      db.bundle.findUnique.mockResolvedValueOnce({
        id: "b1",
        name: "Bundle",
        createdBy: "u1",
        updatedBy: "u2",
        bundleObjects: [
          { id: "o2", fileId: "f2", path: null, required: false, notes: null, sortOrder: 2 },
          { id: "o1", fileId: "f1", path: "a/b", required: true, notes: "n", sortOrder: 1 },
        ],
        assignments: [
          {
            id: "as2",
            recipientId: "r2",
            maxDownloads: null,
            cooldownSeconds: 10,
            verificationType: null,
          },
          {
            id: "as1",
            recipientId: "r1",
            maxDownloads: 3,
            cooldownSeconds: null,
            verificationType: "OTP",
          },
        ],
      });
      const got = await serializeAggregate(db as any, "BUNDLE", "b1");
      expect(got).toEqual({
        id: "b1",
        name: "Bundle",
        objects: [
          { id: "o1", fileId: "f1", path: "a/b", required: true, notes: "n", sortOrder: 1 },
          { id: "o2", fileId: "f2", path: null, required: false, notes: null, sortOrder: 2 },
        ],
        assignments: [
          {
            id: "as1",
            recipientId: "r1",
            maxDownloads: 3,
            cooldownSeconds: null,
            verificationType: "OTP",
          },
          {
            id: "as2",
            recipientId: "r2",
            maxDownloads: null,
            cooldownSeconds: 10,
            verificationType: null,
          },
        ],
        policy: {},
        createdBy: "u1",
        updatedBy: "u2",
      });
    });

    it("serializes RECIPIENT minimally", async () => {
      db.recipient.findUnique.mockResolvedValueOnce({
        id: "r1",
        email: "a@b.c",
        name: null,
        createdBy: "u1",
        updatedBy: null,
      });
      const got = await serializeAggregate(db as any, "RECIPIENT", "r1");
      expect(got).toEqual({
        id: "r1",
        email: "a@b.c",
        name: null,
        createdBy: "u1",
        updatedBy: null,
      });
    });

    it("redacts secrets for TRIGGER_DEFINITION", async () => {
      db.triggerDefinition.findUnique.mockResolvedValueOnce({
        id: "td1",
        name: "T",
        capabilityId: "cap",
        config: { password: "p", nested: { token: "t", ok: 1, arr: [{ secretKey: "s" }] } },
        isEnabled: true,
        createdBy: "u1",
        updatedBy: null,
      });
      const got = await serializeAggregate(db as any, "TRIGGER_DEFINITION", "td1");
      expect(got).toEqual({
        id: "td1",
        name: "T",
        capabilityId: "cap",
        config: {
          password: { secretRef: "cfg:password" },
          nested: {
            token: { secretRef: "cfg:token" },
            ok: 1,
            arr: [{ secretKey: { secretRef: "cfg:secretKey" } }],
          },
        },
        isEnabled: true,
        createdBy: "u1",
        updatedBy: null,
      });
    });

    it("redacts secrets for ACTION_DEFINITION", async () => {
      db.actionDefinition.findUnique.mockResolvedValueOnce({
        id: "ad1",
        name: "A",
        capabilityId: "cap",
        config: { apiKey: "k", credentials: { accessKey: "a", secretKey: "b" } },
        isEnabled: false,
        createdBy: "u1",
        updatedBy: "u2",
      });
      const got = await serializeAggregate(db as any, "ACTION_DEFINITION", "ad1");
      expect(got).toEqual({
        id: "ad1",
        name: "A",
        capabilityId: "cap",
        config: {
          apiKey: { secretRef: "cfg:apiKey" },
          credentials: { secretRef: "cfg:credentials" },
        },
        isEnabled: false,
        createdBy: "u1",
        updatedBy: "u2",
      });
    });

    it("returns null for unknown ids", async () => {
      db.recipient.findUnique.mockResolvedValueOnce(null);
      const got = await serializeAggregate(db as any, "RECIPIENT", "missing");
      expect(got).toBeNull();
    });
  });
});
