import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../http/validate.js";
import type { RequestLike } from "../http/http-server.js";
import { createResponseCapture } from "@tests/helpers/response";

describe("validate helper", () => {
  it("parses body/query/params via zod and calls handler", async () => {
    const handler = vi.fn(async (_req: RequestLike, res: ResponseLike) => {
      res.status(201).json({ ok: true });
    });
    const wrapped = validate({
      body: z.object({ id: z.string() }),
      query: z.object({ q: z.string().optional() }),
      params: z.object({ pid: z.string() }),
    })(handler);

    const req: RequestLike = { body: { id: "123" }, query: { q: "hey" }, params: { pid: "p" } };
    const rc = createResponseCapture();
    await wrapped(req, rc.res);
    expect(handler).toHaveBeenCalledOnce();
    expect(rc.status).toBe(201);
    expect(rc.body).toEqual({ ok: true });
  });
});
