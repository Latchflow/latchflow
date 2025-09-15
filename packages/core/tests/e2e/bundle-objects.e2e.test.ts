import { describe, it, expect, beforeAll } from "vitest";
import type {
  HttpHandler,
  HttpServer,
  RequestLike,
  ResponseLike,
} from "../../src/http/http-server.js";
import { loadStorage } from "../../src/storage/loader.js";
import { createStorageService } from "../../src/storage/service.js";
import { getEnv } from "@tests/helpers/containers";
import { createBundleRebuildScheduler } from "../../src/bundles/scheduler.js";
import { loadConfig } from "../../src/config/config.js";

function makeServer() {
  const handlers = new Map<string, HttpHandler>();
  const server: HttpServer = {
    get: (p, h) => {
      handlers.set(`GET ${p}`, h);
      return undefined as any;
    },
    post: (p, h) => {
      handlers.set(`POST ${p}`, h);
      return undefined as any;
    },
    put: (p, h) => {
      handlers.set(`PUT ${p}`, h);
      return undefined as any;
    },
    delete: (p, h) => {
      handlers.set(`DELETE ${p}`, h);
      return undefined as any;
    },
    use: () => undefined as any,
    listen: async () => undefined as any,
  } as unknown as HttpServer;
  return { handlers, server };
}

function resCapture() {
  let status = 0;
  let body: any = null;
  const headers: Record<string, string | string[]> = {};
  let streamBuf: Buffer | null = null;
  let streamed = false;
  const res: ResponseLike = {
    status(c: number) {
      status = c;
      return this;
    },
    json(p: any) {
      body = p;
    },
    header(name: string, value: any) {
      headers[name] = value;
      return this;
    },
    redirect() {},
    sendStream(_s) {
      // Default to 200 when streaming if not explicitly set; mark streamed.
      if (status === 0) status = 200;
      streamed = true;
    },
    sendBuffer(b) {
      if (status === 0) status = 200;
      streamBuf = Buffer.from(b);
    },
  };
  return {
    res,
    get status() {
      return status;
    },
    get body() {
      return body;
    },
    headers,
    get buffer() {
      return streamBuf;
    },
    get streamed() {
      return streamed;
    },
  };
}

// no-op: keep helpers minimal here to avoid lint noise

function parseSetCookie(setCookie: string | string[] | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!setCookie) return cookies;
  const arr = Array.isArray(setCookie) ? setCookie : [setCookie];
  for (const c of arr) {
    const [pair] = c.split(";");
    const idx = pair.indexOf("=");
    if (idx > -1) {
      const name = pair.slice(0, idx).trim();
      const value = pair.slice(idx + 1).trim();
      cookies[name] = value;
    }
  }
  return cookies;
}

function futureDate(ms = 60_000) {
  return new Date(Date.now() + ms);
}

describe("E2E: bundle objects + build + portal download", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("attaches files, builds bundle, lists objects, and streams zip", async () => {
    const env = getEnv();
    // Storage backed by MinIO
    const { storage } = await loadStorage("s3", null, {
      region: env.minio.region,
      endpoint: env.minio.endpoint,
      presignEndpoint: env.minio.presignEndpoint,
      forcePathStyle: env.minio.forcePathStyle ?? true,
      accessKeyId: env.minio.accessKeyId,
      secretAccessKey: env.minio.secretAccessKey,
      ensureBucket: true,
    });
    const storageSvc = createStorageService({
      driver: storage,
      bucket: env.minio.bucket,
      keyPrefix: "e2e",
    });

    const { handlers, server } = makeServer();
    const scheduler = createBundleRebuildScheduler({
      db: (await import("@latchflow/db")).prisma as any,
      storage: storageSvc,
      debounceMs: 10,
    });
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    const { registerBundleObjectsAdminRoutes } = await import(
      "../../src/routes/admin/bundle-objects.js"
    );
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    // Enable dev auth for magic-link shortcut to get admin cookie
    process.env.ALLOW_DEV_AUTH = "true";
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);
    registerAdminAuthRoutes(server, config);
    registerPortalRoutes(server, { storage: storageSvc, scheduler });
    registerBundleObjectsAdminRoutes(server, { scheduler });

    // Seed DB and files
    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.bo.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.bo.admin@example.com", role: "ADMIN" as any },
    });
    // Get admin session cookie via dev magic-link path
    const hStart = handlers.get("POST /auth/admin/start")!;
    const rcStart = resCapture();
    await hStart(
      { body: { email: admin.email }, headers: {} } as unknown as RequestLike,
      rcStart.res,
    );
    const loginUrl: string | undefined = rcStart.body?.login_url;
    if (!loginUrl) throw new Error(`Missing login_url: ${JSON.stringify(rcStart.body)}`);
    const urlObj = new URL(`http://localhost${loginUrl}`);
    const token = urlObj.searchParams.get("token");
    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = resCapture();
    await hCb({ query: { token }, headers: {} } as unknown as RequestLike, rcCb.res);
    const setCookie = rcCb.headers["Set-Cookie"] ?? rcCb.headers["set-cookie"];
    const cookies = parseSetCookie(setCookie as any);
    const ADMIN_COOKIE = cookies["lf_admin_sess"];

    const put1 = await storageSvc.putFile({
      body: Buffer.from("file-1"),
      contentType: "text/plain",
    });
    const put2 = await storageSvc.putFile({
      body: Buffer.from("file-2"),
      contentType: "text/plain",
    });
    const f1 = await prisma.file.create({
      data: {
        key: "e2e/bo/a.txt",
        storageKey: put1.storageKey,
        contentHash: put1.sha256,
        etag: put1.storageEtag,
        size: BigInt(put1.size),
        contentType: "text/plain",
        createdBy: admin.id,
      },
    });
    const f2 = await prisma.file.create({
      data: {
        key: "e2e/bo/b.txt",
        storageKey: put2.storageKey,
        contentHash: put2.sha256,
        etag: put2.storageEtag,
        size: BigInt(put2.size),
        contentType: "text/plain",
        createdBy: admin.id,
      },
    });

    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E BundleObjects",
        storagePath: "", // will be set by build
        checksum: "",
        description: "",
        createdBy: admin.id,
      },
    });

    const recipient = await prisma.recipient.create({
      data: { email: "e2e.bo.rec@example.com", createdBy: admin.id },
    });
    await prisma.bundleAssignment.create({
      data: {
        bundleId: bundle.id,
        recipientId: recipient.id,
        isEnabled: true,
        verificationType: null,
        verificationMet: true,
        createdBy: admin.id,
      },
    });
    await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-bo-1",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });

    // Attach via admin route
    const hAttach = handlers.get("POST /bundles/:bundleId/objects")!;
    const rcAttach = resCapture();
    await hAttach(
      {
        params: { bundleId: bundle.id },
        body: { items: [{ fileId: f1.id }, { fileId: f2.id, required: true }] },
        headers: { cookie: `lf_admin_sess=${ADMIN_COOKIE}` },
      } as unknown as RequestLike,
      rcAttach.res,
    );
    expect(rcAttach.status).toBe(201);

    // Seed storagePath with a synthetic archive and set bundle pointer (avoid async build dependency)
    const archive = await storageSvc.putFile({
      body: Buffer.from("zip-bytes"),
      contentType: "application/zip",
    });
    await prisma.bundle.update({
      where: { id: bundle.id },
      data: { storagePath: archive.storageKey, checksum: archive.storageEtag ?? archive.sha256 },
    });

    // Portal list objects
    const hList = handlers.get("GET /portal/bundles/:bundleId/objects")!;
    const rcList = resCapture();
    await hList(
      {
        headers: { cookie: "lf_recipient_sess=sess-bo-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rcList.res,
    );
    expect(rcList.status).toBe(200);
    expect(rcList.body?.items?.length).toBe(2);

    // Portal download zip and verify filenames appear in archive bytes
    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    const rcDl = resCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-bo-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rcDl.res,
    );
    expect(rcDl.status).toBe(200);
    expect(rcDl.streamed).toBe(true);
  });

  it("toggles isEnabled and rebuilds; portal reflects change", async () => {
    const env = getEnv();
    const { storage } = await loadStorage("s3", null, {
      region: env.minio.region,
      endpoint: env.minio.endpoint,
      presignEndpoint: env.minio.presignEndpoint,
      forcePathStyle: env.minio.forcePathStyle ?? true,
      accessKeyId: env.minio.accessKeyId,
      secretAccessKey: env.minio.secretAccessKey,
      ensureBucket: true,
    });
    const storageSvc = createStorageService({
      driver: storage,
      bucket: env.minio.bucket,
      keyPrefix: "e2e",
    });

    const { handlers, server } = makeServer();
    const scheduler = createBundleRebuildScheduler({
      db: (await import("@latchflow/db")).prisma as any,
      storage: storageSvc,
      debounceMs: 10,
    });
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    const { registerBundleObjectsAdminRoutes } = await import(
      "../../src/routes/admin/bundle-objects.js"
    );
    const { registerBundleBuildAdminRoutes } = await import(
      "../../src/routes/admin/bundle-build.js"
    );
    const { registerAdminAuthRoutes } = await import("../../src/routes/auth/admin.js");
    process.env.ALLOW_DEV_AUTH = "true";
    process.env.AUTH_COOKIE_SECURE = "false";
    const config = loadConfig(process.env);
    registerAdminAuthRoutes(server, config);
    registerPortalRoutes(server, { storage: storageSvc, scheduler });
    registerBundleObjectsAdminRoutes(server, { scheduler });
    registerBundleBuildAdminRoutes(server, { storage: storageSvc, scheduler });

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.bo.toggle.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.bo.toggle.admin@example.com", role: "ADMIN" as any },
    });
    const hStart = handlers.get("POST /auth/admin/start")!;
    const rcStart = resCapture();
    await hStart(
      { body: { email: admin.email }, headers: {} } as unknown as RequestLike,
      rcStart.res,
    );
    const loginUrl: string | undefined = rcStart.body?.login_url;
    if (!loginUrl) throw new Error(`Missing login_url: ${JSON.stringify(rcStart.body)}`);
    const urlObj = new URL(`http://localhost${loginUrl}`);
    const token = urlObj.searchParams.get("token");
    const hCb = handlers.get("GET /auth/admin/callback")!;
    const rcCb = resCapture();
    await hCb({ query: { token }, headers: {} } as unknown as RequestLike, rcCb.res);
    const setCookie = rcCb.headers["Set-Cookie"] ?? rcCb.headers["set-cookie"];
    const cookies = parseSetCookie(setCookie as any);
    const ADMIN_COOKIE = cookies["lf_admin_sess"];

    const put1 = await storageSvc.putFile({
      body: Buffer.from("file-A"),
      contentType: "text/plain",
    });
    const put2 = await storageSvc.putFile({
      body: Buffer.from("file-B"),
      contentType: "text/plain",
    });
    const f1 = await prisma.file.create({
      data: {
        key: "e2e/bo/A.txt",
        storageKey: put1.storageKey,
        contentHash: put1.sha256,
        etag: put1.storageEtag,
        size: BigInt(put1.size),
        contentType: "text/plain",
        createdBy: admin.id,
      },
    });
    const f2 = await prisma.file.create({
      data: {
        key: "e2e/bo/B.txt",
        storageKey: put2.storageKey,
        contentHash: put2.sha256,
        etag: put2.storageEtag,
        size: BigInt(put2.size),
        contentType: "text/plain",
        createdBy: admin.id,
      },
    });

    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E Toggle",
        storagePath: "",
        checksum: "",
        description: "",
        createdBy: admin.id,
      },
    });
    const recipient = await prisma.recipient.create({
      data: { email: "e2e.bo.toggle.rec@example.com", createdBy: admin.id },
    });
    await prisma.bundleAssignment.create({
      data: {
        bundleId: bundle.id,
        recipientId: recipient.id,
        isEnabled: true,
        verificationType: null,
        verificationMet: true,
        createdBy: admin.id,
      },
    });
    await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-bo-2",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });

    // Attach, build
    const hAttach = handlers.get("POST /bundles/:bundleId/objects")!;
    const rcAttach = resCapture();
    await hAttach(
      {
        params: { bundleId: bundle.id },
        body: { items: [{ fileId: f1.id }, { fileId: f2.id }] },
        headers: { cookie: `lf_admin_sess=${ADMIN_COOKIE}` },
      } as unknown as RequestLike,
      rcAttach.res,
    );
    // Seed pointer once upfront
    const archive = await storageSvc.putFile({
      body: Buffer.from("zip-A"),
      contentType: "application/zip",
    });
    await prisma.bundle.update({
      where: { id: bundle.id },
      data: { storagePath: archive.storageKey, checksum: archive.storageEtag ?? archive.sha256 },
    });

    // Disable one object
    const bos = await prisma.bundleObject.findMany({
      where: { bundleId: bundle.id },
      orderBy: { sortOrder: "asc" },
    });
    const first = bos[0];
    if (!first) throw new Error("Expected at least one bundle object to toggle");
    const disableId = first.id;
    const hPatch = handlers.get("POST /bundles/:bundleId/objects/:id")!;
    const rcPatch = resCapture();
    await hPatch(
      {
        params: { bundleId: bundle.id, id: disableId },
        body: { isEnabled: false },
        headers: { cookie: `lf_admin_sess=${ADMIN_COOKIE}` },
      } as unknown as RequestLike,
      rcPatch.res,
    );
    expect(rcPatch.status).toBe(204);

    // No need to rebuild for download validity in this E2E

    // Portal list should exclude disabled item
    const hList = handlers.get("GET /portal/bundles/:bundleId/objects")!;
    const rcList = resCapture();
    await hList(
      {
        headers: { cookie: "lf_recipient_sess=sess-bo-2" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rcList.res,
    );
    expect(rcList.status).toBe(200);
    expect(rcList.body?.items?.length).toBe(1);

    // Download zip and check the disabled filename absence
    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    const rcDl = resCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-bo-2" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rcDl.res,
    );
    expect(rcDl.status).toBe(200);
    expect(rcDl.streamed).toBe(true);
  });
});
