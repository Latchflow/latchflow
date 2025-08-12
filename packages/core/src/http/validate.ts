import { type ZodSchema } from "zod";
import type { HttpHandler, RequestLike, ResponseLike } from "./http-server.js";

export function validate(opts: { body?: ZodSchema; query?: ZodSchema; params?: ZodSchema }) {
  return (handler: HttpHandler): HttpHandler => {
    return async (req: RequestLike, res: ResponseLike) => {
      if (opts.params) req.params = opts.params.parse(req.params);
      if (opts.query) req.query = opts.query.parse(req.query);
      if (opts.body) req.body = opts.body.parse(req.body);
      return handler(req, res);
    };
  };
}
