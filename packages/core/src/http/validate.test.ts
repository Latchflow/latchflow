import { describe, it, expect, vi } from "vitest";
import { z } from "zod";
import { validate } from "../http/validate.js";
import type { RequestLike, ResponseLike } from "../http/http-server.js";

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
    let status = 0;
    let json: unknown = null;
    const res: ResponseLike = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        json = payload;
      },
      header() {
        return this;
      },
      redirect() {},
    };
    await wrapped(req, res);
    expect(handler).toHaveBeenCalledOnce();
    expect(status).toBe(201);
    expect(json).toEqual({ ok: true });
  });
});
