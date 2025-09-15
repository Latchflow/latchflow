export interface RequestLike {
  params?: unknown;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  userAgent?: string;
  // Optional auth context provided by middleware (e.g., bearer token path)
  user?: { id: string };
  // Optional uploaded file context (when multipart is parsed upstream)
  file?: {
    buffer?: Buffer;
    fieldname?: string;
    originalname?: string;
    mimetype?: string;
    size?: number;
    // When disk storage is used by the multipart parser
    path?: string;
  };
}

export interface ResponseLike {
  status(code: number): ResponseLike;
  json(payload: unknown): void;
  header(name: string, value: string | string[]): ResponseLike;
  redirect(url: string, status?: number): void;
  // Stream or buffer sending helpers for binary responses
  sendStream(body: NodeJS.ReadableStream, headers?: Record<string, string | string[]>): void;
  sendBuffer(body: Buffer, headers?: Record<string, string | string[]>): void;
}

export type HttpHandler = (req: RequestLike, res: ResponseLike) => Promise<void> | void;

export interface HttpServer {
  get(path: string, handler: HttpHandler): void;
  post(path: string, handler: HttpHandler): void;
  put(path: string, handler: HttpHandler): void;
  patch(path: string, handler: HttpHandler): void;
  delete(path: string, handler: HttpHandler): void;
  use(mw: unknown): void;
  listen(port: number): Promise<void>;
}
