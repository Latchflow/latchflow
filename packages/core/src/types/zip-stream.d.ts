declare module "zip-stream" {
  export default class ZipStream {
    pipe(dst: NodeJS.WritableStream): void;
    entry(
      source: NodeJS.ReadableStream | Buffer,
      options: { name: string; store?: boolean; date?: Date },
      cb: (err: Error | null) => void,
    ): void;
    finish(cb: () => void): void;
  }
}
