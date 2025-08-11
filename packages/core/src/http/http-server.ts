export interface RequestLike {
  params?: unknown;
  query?: unknown;
  body?: unknown;
}

export interface ResponseLike {
  status(code: number): ResponseLike;
  json(payload: unknown): void;
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
