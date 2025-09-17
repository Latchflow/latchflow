import type { ResponseLike } from "../../src/http/http-server.js";

export interface ResponseCaptureOptions {
  defaultStatus?: number;
}

export interface ResponseCapture {
  readonly res: ResponseLike;
  readonly headers: Record<string, string | string[]>;
  readonly redirected?: { url: string; status?: number };
  readonly streamed: boolean;
  readonly buffer?: Buffer;
  readonly stream?: {
    body: NodeJS.ReadableStream;
    stream: NodeJS.ReadableStream;
    headers: Record<string, string | string[]>;
  };
  /** Last response status code that was set (0 when unset). */
  status: number;
  /** Last payload passed to json(). */
  body: unknown;
}

export function createResponseCapture(options: ResponseCaptureOptions = {}): ResponseCapture {
  const headers: Record<string, string | string[]> = {};
  const defaultStatus = options.defaultStatus ?? 200;
  let status = 0;
  let body: unknown = undefined;
  let redirected: { url: string; status?: number } | undefined;
  let streamed = false;
  let buffer: Buffer | undefined;
  let streamInfo:
    | {
        body: NodeJS.ReadableStream;
        stream: NodeJS.ReadableStream;
        headers: Record<string, string | string[]>;
      }
    | undefined;

  const applyDefaultStatus = () => {
    if (status === 0) status = defaultStatus;
  };

  const res: ResponseLike = {
    status(code: number) {
      status = code;
      return this;
    },
    sendStatus(code: number) {
      status = code;
    },
    json(payload: unknown) {
      body = payload;
    },
    header(name: string, value: string | string[]) {
      headers[name] = value;
      return this;
    },
    redirect(url: string, code?: number) {
      if (typeof code === "number") {
        status = code;
      }
      redirected = { url, status: code };
    },
    sendStream(_body: NodeJS.ReadableStream, extraHeaders?: Record<string, string | string[]>) {
      applyDefaultStatus();
      streamed = true;
      if (extraHeaders) {
        for (const [key, value] of Object.entries(extraHeaders)) {
          headers[key] = value;
        }
      }
      streamInfo = {
        body: _body,
        stream: _body,
        headers: { ...(extraHeaders ?? {}) },
      };
      if (!extraHeaders) {
        streamInfo.headers = {};
      }
    },
    sendBuffer(payload: Buffer, extraHeaders?: Record<string, string | string[]>) {
      applyDefaultStatus();
      buffer = Buffer.from(payload);
      if (extraHeaders) {
        for (const [key, value] of Object.entries(extraHeaders)) {
          headers[key] = value;
        }
      }
    },
  };

  return {
    get res() {
      return res;
    },
    get headers() {
      return headers;
    },
    get redirected() {
      return redirected;
    },
    get streamed() {
      return streamed;
    },
    get buffer() {
      return buffer;
    },
    get stream() {
      return streamInfo;
    },
    get status() {
      return status;
    },
    set status(value: number) {
      status = value;
    },
    get body() {
      return body;
    },
    set body(value: unknown) {
      body = value;
    },
  } satisfies ResponseCapture;
}
