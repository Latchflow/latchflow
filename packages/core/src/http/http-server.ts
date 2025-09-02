export interface RequestLike {
  params?: unknown;
  query?: unknown;
  body?: unknown;
  headers?: Record<string, string | string[] | undefined>;
  ip?: string;
  userAgent?: string;
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
  delete(path: string, handler: HttpHandler): void;
  use(mw: unknown): void;
  listen(port: number): Promise<void>;
}
