import { describe, it, expect } from "vitest";

import { resolveEffectiveUserId, toPrismaActorFields, type ActorContext } from "./actor.js";

describe("history/actor", () => {
  describe("resolveEffectiveUserId", () => {
    const cfg = { SYSTEM_USER_ID: "sys" } as const;

    it("returns user id for USER actors", () => {
      const actor: ActorContext = { actorType: "USER", actorUserId: "u1" };
      expect(resolveEffectiveUserId(cfg, actor)).toBe("u1");
    });

    it("returns onBehalfOf for ACTION actors when provided", () => {
      const actor: ActorContext = {
        actorType: "ACTION",
        actorInvocationId: "inv1",
        actorActionDefinitionId: "actdef1",
        onBehalfOfUserId: "u2",
      };
      expect(resolveEffectiveUserId(cfg, actor)).toBe("u2");
    });

    it("falls back to system user for ACTION actors without onBehalfOf", () => {
      const actor: ActorContext = { actorType: "ACTION" };
      expect(resolveEffectiveUserId(cfg, actor)).toBe("sys");
    });

    it("returns system user for SYSTEM actors", () => {
      const actor: ActorContext = { actorType: "SYSTEM" };
      expect(resolveEffectiveUserId(cfg, actor)).toBe("sys");
    });
  });

  describe("toPrismaActorFields", () => {
    it("maps USER fields", () => {
      const out = toPrismaActorFields({
        actorType: "USER",
        actorUserId: "abc",
        onBehalfOfUserId: "x",
      });
      expect(out).toEqual({
        actorType: "USER",
        actorUserId: "abc",
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: "x",
      });
    });

    it("maps ACTION fields with null defaults", () => {
      const out = toPrismaActorFields({ actorType: "ACTION" });
      expect(out).toEqual({
        actorType: "ACTION",
        actorUserId: null,
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
      });
    });

    it("maps ACTION fields when provided", () => {
      const out = toPrismaActorFields({
        actorType: "ACTION",
        actorInvocationId: "inv",
        actorActionDefinitionId: "actdef",
        onBehalfOfUserId: "u3",
      });
      expect(out).toEqual({
        actorType: "ACTION",
        actorUserId: null,
        actorInvocationId: "inv",
        actorActionDefinitionId: "actdef",
        onBehalfOfUserId: "u3",
      });
    });

    it("maps SYSTEM fields", () => {
      const out = toPrismaActorFields({ actorType: "SYSTEM" });
      expect(out).toEqual({
        actorType: "SYSTEM",
        actorUserId: null,
        actorInvocationId: null,
        actorActionDefinitionId: null,
        onBehalfOfUserId: null,
      });
    });
  });
});
