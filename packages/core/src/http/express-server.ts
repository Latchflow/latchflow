import express, {
  type ErrorRequestHandler,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import helmet from "helmet";
import cors from "cors";
import pinoHttp from "pino-http";
import multer from "multer";
import os from "node:os";
import type { HttpServer, RequestLike, ResponseLike, HttpHandler } from "./http-server.js";

export function createExpressServer(): HttpServer {
  const app = express();
  app.use(helmet());
  app.use(cors());
  // Parse multipart using disk storage to avoid buffering large files in memory.
  // Applied globally; it activates only for multipart/form-data requests.
  const upload = multer({
    storage: multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, os.tmpdir()),
      filename: (_req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
    }),
    // Do not enforce file size limit here; allow policy at route level if needed.
  });
  app.use(upload.single("file"));
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
    type MulterFileLike = {
      buffer?: Buffer;
      fieldname?: string;
      originalname?: string;
      mimetype?: string;
      size?: number;
      path?: string;
    };
    const requestWithFile = req as Request & { file?: MulterFileLike };
    const mfile = requestWithFile.file;
    const reqAdapter: RequestLike = {
      params: req.params,
      query: req.query as unknown,
      body: req.body as unknown,
      headers: req.headers,
      ip: req.ip,
      userAgent: req.headers["user-agent"] as string | undefined,
      file: mfile
        ? {
            buffer: mfile.buffer,
            fieldname: mfile.fieldname,
            originalname: mfile.originalname,
            mimetype: mfile.mimetype,
            size: mfile.size,
            path: mfile.path,
          }
        : undefined,
    };
    const resAdapter: ResponseLike = {
      status(code: number) {
        res.status(code);
        return this;
      },
      json(payload: unknown) {
        res.json(payload);
      },
      header(name: string, value: string | string[]) {
        // Express allows string[] for 'Set-Cookie'
        (res as Response).setHeader(name, value as unknown as string | readonly string[]);
        return this;
      },
      redirect(url: string, status?: number) {
        if (status) res.redirect(status, url);
        else res.redirect(url);
      },
      sendStream(body, headers) {
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            (res as Response).setHeader(k, v as unknown as string | readonly string[]);
          }
        }
        const onError = (err: unknown) => {
          // If nothing was sent yet, respond with JSON error; otherwise just destroy
          if (!(res as Response).headersSent) {
            try {
              (res as Response).status(500).json({
                status: "error",
                code: "STREAM_ERROR",
                message: (err as Error)?.message ?? "Stream error",
              });
            } catch {
              try {
                (res as Response).end();
              } catch {
                // Ignore
              }
            }
          } else {
            try {
              (res as Response).end();
            } catch {
              // Ignore
            }
          }
        };
        const onClose = () => {
          try {
            const anyBody = body as unknown as { destroy?: () => void };
            if (typeof anyBody.destroy === "function") anyBody.destroy();
          } catch {
            // Ignore
          }
        };
        (res as Response).once("close", onClose);
        body.once("error", onError);
        // Pipe without manual event forwarding; Node handles backpressure
        body.pipe(res);
      },
      sendBuffer(body, headers) {
        if (headers) {
          for (const [k, v] of Object.entries(headers)) {
            (res as Response).setHeader(k, v as unknown as string | readonly string[]);
          }
        }
        (res as Response).end(body);
      },
    };
    Promise.resolve(h(reqAdapter, resAdapter)).catch(next);
  };
  return {
    get: (p, h) => app.get(p, wrap(h)),
    post: (p, h) => app.post(p, wrap(h)),
    put: (p, h) => app.put(p, wrap(h)),
    patch: (p, h) => app.patch(p, wrap(h)),
    delete: (p, h) => app.delete(p, wrap(h)),
    use: (mw: unknown) => {
      if (typeof mw === "function") {
        app.use(mw as unknown as import("express").RequestHandler);
      }
    },
    listen: (port) => new Promise((resolve) => app.listen(port, resolve)),
  };
}
