import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import type { HttpServer, RequestLike, ResponseLike, HttpHandler } from "./http-server";

export function createExpressServer(): HttpServer {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(pinoHttp());
  // Basic JSON error handler
  // eslint-disable-next-line
  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    const status =
      typeof (err as { status?: unknown })?.status === "number"
        ? (err as { status: number }).status
        : 500;
    (res as Response).status(status).json({
      status: "error",
      code: (err as { code?: string }).code || "INTERNAL",
      message: (err as Error).message || "Internal Server Error",
    });
  };
  app.use(errorHandler);

  const wrap = (h: HttpHandler) => (req: Request, res: Response, next: NextFunction) => {
    const resAdapter: ResponseLike = {
      status(code: number) {
        res.status(code);
        return this;
      },
      json(payload: unknown) {
        res.json(payload);
      },
    };
    Promise.resolve(h(req as unknown as RequestLike, resAdapter)).catch(next);
  };
  return {
    get: (p, h) => app.get(p, wrap(h)),
    post: (p, h) => app.post(p, wrap(h)),
    put: (p, h) => app.put(p, wrap(h)),
    delete: (p, h) => app.delete(p, wrap(h)),
    use: (mw: unknown) => {
      if (typeof mw === "function") {
        app.use(mw as unknown as import("express").RequestHandler);
      }
    },
    listen: (port) => new Promise((resolve) => app.listen(port, resolve)),
  };
}
