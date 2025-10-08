import { describe, it, expect, beforeAll } from "vitest";
import type { HttpHandler, HttpServer, RequestLike } from "../../src/http/http-server.js";
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

describe("E2E: portal assignments summary", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("reports downloadsUsed/Remaining and cooldown fields", async () => {
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
    const { registerPortalRoutes } = await import("../../src/routes/portal.js");
    registerPortalRoutes(server, { storage: storageSvc });

    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.assign.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.assign.admin@example.com", role: "ADMIN" as any },
    });
    const put = await storageSvc.putFile({
      body: Buffer.from("zip3"),
      contentType: "application/zip",
    });
    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E Assign",
        storagePath: put.storageKey,
        checksum: put.storageEtag ?? put.sha256,
        description: "",
        createdBy: admin.id,
      },
    });
    const recipient = await prisma.recipient.create({
      data: { email: "e2e.assign.rec@example.com", createdBy: admin.id },
    });
    // Create an assignment so the recipient is authorized to download,
    // and configure limits to validate summary fields.
    await prisma.bundleAssignment.create({
      data: {
        bundleId: bundle.id,
        recipientId: recipient.id,
        isEnabled: true,
        verificationType: null,
        verificationMet: true,
        maxDownloads: 2,
        cooldownSeconds: 1,
        createdBy: admin.id,
      },
    });
    await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-assign-1",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });

    // Make one download to increment used and set lastDownloadAt
    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    const r0 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-assign-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      r0.res,
    );
    expect(r0.status).toBe(200);
    expect(r0.streamed).toBe(true);

    // Query assignments summary
    const hSum = handlers.get("GET /portal/bundles")!;
    const rc = createResponseCapture();
    await hSum(
      { headers: { cookie: "lf_recipient_sess=sess-assign-1" } } as unknown as RequestLike,
      rc.res,
    );
    expect(rc.status).toBe(200);
    expect(Array.isArray(rc.body?.items)).toBe(true);
    const it = rc.body.items.find((x: any) => x.summary.bundleId === bundle.id);
    expect(it).toBeTruthy();
    expect(it.summary.maxDownloads).toBe(2);
    expect(it.summary.downloadsUsed).toBe(1);
    expect(it.summary.downloadsRemaining).toBe(1);
    expect(it.summary.cooldownSeconds).toBe(1);
    // cooldownRemainingSeconds may be 0..1 depending on timing; only assert present
    expect(typeof it.summary.cooldownRemainingSeconds).toBe("number");
  });
});
