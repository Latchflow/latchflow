import { describe, it, expect, beforeAll } from "vitest";
import type { HttpHandler, HttpServer } from "../../src/http/http-server.js";
import { loadStorage } from "../../src/storage/loader.js";
import { createStorageService } from "../../src/storage/service.js";
import { getEnv } from "@tests/helpers/containers";
import { createResponseCapture } from "@tests/helpers/response";

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

function futureDate(ms = 60_000) {
  return new Date(Date.now() + ms);
}

describe("E2E: recipient portal", () => {
  beforeAll(() => {
    // Ensure containers env is initialized (DATABASE_URL set in e2e setup)
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("serves /portal/me and streams bundle download with DownloadEvent", async () => {
    const env = getEnv();
    // Build storage service backed by MinIO
    const s3conf = {
      region: env.minio.region,
      endpoint: env.minio.endpoint,
      presignEndpoint: env.minio.presignEndpoint,
      forcePathStyle: env.minio.forcePathStyle ?? true,
      accessKeyId: env.minio.accessKeyId,
      secretAccessKey: env.minio.secretAccessKey,
      ensureBucket: true,
    } as const;
    const { storage } = await loadStorage("s3", null, s3conf);
    const storageSvc = createStorageService({
      driver: storage,
      bucket: env.minio.bucket,
      keyPrefix: "e2e",
    });

    const { handlers, server } = makeServer();
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes(server, { storage: storageSvc });

    // Seed DB with user, file, bundle, recipient, assignment, and recipient session
    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.portal.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.portal.admin@example.com", role: "ADMIN" as any },
    });

    // Upload file and create File record
    const put = await storageSvc.putFile({
      body: Buffer.from("bundle-bytes"),
      contentType: "application/octet-stream",
    });
    const file = await prisma.file.create({
      data: {
        key: "e2e/objects/bundle.bin",
        storageKey: put.storageKey,
        contentHash: put.sha256,
        etag: put.storageEtag,
        size: BigInt(put.size),
        contentType: "application/octet-stream",
        createdBy: admin.id,
      },
    });

    // Create bundle with storagePath referencing the uploaded object
    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E Bundle",
        storagePath: put.storageKey,
        checksum: put.sha256,
        description: "",
        createdBy: admin.id,
      },
    });

    await prisma.bundleObject.create({
      data: {
        bundleId: bundle.id,
        fileId: file.id,
        sortOrder: 0,
        required: false,
        createdBy: admin.id,
      },
    });

    const recipient = await prisma.recipient.create({
      data: { email: "e2e.recipient@example.com", createdBy: admin.id },
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
    const session = await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-e2e-1",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });
    expect(session.jti).toBe("sess-e2e-1");

    // 1) GET /portal/me
    const hMe = handlers.get("GET /portal/me")!;
    const rcMe = createResponseCapture();
    await hMe({ headers: { cookie: "lf_recipient_sess=sess-e2e-1" } } as any, rcMe.res);
    expect(rcMe.status).toBe(200);
    expect(rcMe.body?.recipient?.id).toBe(recipient.id);
    expect(Array.isArray(rcMe.body?.bundles)).toBe(true);

    // 2) GET /portal/bundles/:bundleId (stream)
    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    const rcDl = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-e2e-1" },
        params: { bundleId: bundle.id },
      } as any,
      rcDl.res,
    );
    expect(rcDl.streamed).toBe(true);

    // 3) Verify DownloadEvent recorded
    const events = await prisma.downloadEvent.count({
      where: { bundleAssignment: { bundleId: bundle.id, recipientId: recipient.id } },
    });
    expect(events).toBeGreaterThan(0);
  });
});
