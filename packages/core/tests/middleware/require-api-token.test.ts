import { describe, it, expect, vi } from "vitest";
import type { RequestLike, ResponseLike } from "../../src/http/http-server.js";

vi.mock("../../src/auth/tokens.js", () => ({
  sha256Hex: (s: string) => `h_${s}`,
}));

vi.mock("../../src/db.js", () => {
  const update = vi.fn(async () => ({}));
  const findUnique = vi.fn(async ({ where: { tokenHash } }: any) => {
    if (tokenHash === "h_raw") {
      return {
        id: "tok1",
        tokenHash,
        revokedAt: null,
        expiresAt: null,
        scopes: ["core:read"],
        user: { id: "u1", email: "e", roles: ["ADMIN"] },
      };
    }
    return null;
  });
  return {
    getDb: () => ({ apiToken: { findUnique, update } }),
    __api: { findUnique, update },
  } as any;
});

describe("requireApiToken", () => {
  it("401 when bearer missing", async () => {
    const { requireApiToken } = await import("../../src/middleware/require-api-token.js");
    const wrapped = requireApiToken(["core:read"])((async () => {}) as any);
    await expect(wrapped({ headers: {} } as RequestLike, {} as ResponseLike)).rejects.toMatchObject(
      {
        status: 401,
      },
    );
  });

  it("403 when scope missing", async () => {
    const { requireApiToken } = await import("../../src/middleware/require-api-token.js");
    const wrapped = requireApiToken(["core:write"])((async () => {}) as any);
    const req = { headers: { authorization: "Bearer raw" } } as RequestLike;
    await expect(wrapped(req, {} as ResponseLike)).rejects.toMatchObject({ status: 403 });
    const mod = await import("../../src/db.js");
    expect((mod as any).__api.update).not.toHaveBeenCalled();
  });

  it("calls handler and updates lastUsedAt when authorized", async () => {
    const { requireApiToken } = await import("../../src/middleware/require-api-token.js");
    const handler = vi.fn(async () => {});
    const wrapped = requireApiToken(["core:read"])(handler as any);
    const req = { headers: { authorization: "Bearer raw" } } as RequestLike;
    await wrapped(req, {} as ResponseLike);
    expect(handler).toHaveBeenCalledOnce();
    const mod = await import("../../src/db.js");
    expect((mod as any).__api.update).toHaveBeenCalledTimes(1);
  });
});
