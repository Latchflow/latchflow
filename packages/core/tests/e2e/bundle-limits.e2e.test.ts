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

describe("E2E: bundle download limits (portal)", () => {
  beforeAll(() => {
    // Ensure containers env is initialized (DATABASE_URL set in e2e setup)
    expect(getEnv().postgres.url).toBeTruthy();
  });

  it("enforces maxDownloads=1 (second download returns 403)", async () => {
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
    // Seed a small archive and bundle pointer
    const admin = await prisma.user.upsert({
      where: { email: "e2e.limits.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.limits.admin@example.com", role: "ADMIN" as any },
    });
    const put = await storageSvc.putFile({
      body: Buffer.from("zip"),
      contentType: "application/zip",
    });
    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E Limits",
        storagePath: put.storageKey,
        checksum: put.storageEtag ?? put.sha256,
        description: "",
        createdBy: admin.id,
      },
    });
    const recipient = await prisma.recipient.create({
      data: { email: "e2e.limits.rec@example.com", createdBy: admin.id },
    });
    await prisma.bundleAssignment.create({
      data: {
        bundleId: bundle.id,
        recipientId: recipient.id,
        isEnabled: true,
        verificationType: null,
        verificationMet: true,
        maxDownloads: 1,
        cooldownSeconds: null,
        createdBy: admin.id,
      },
    });
    await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-limits-1",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });

    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    // First download OK
    const rc1 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-limits-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rc1.res,
    );
    expect(rc1.status).toBe(200);
    expect(rc1.streamed).toBe(true);
    // Second download blocked
    const rc2 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-limits-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      rc2.res,
    );
    expect(rc2.status).toBe(403);
    expect(rc2.body?.code).toBe("MAX_DOWNLOADS_EXCEEDED");
  });

  it("enforces cooldown (429) then allows after waiting", async () => {
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
      where: { email: "e2e.cooldown.admin@example.com" },
      update: { role: "ADMIN" as any },
      create: { email: "e2e.cooldown.admin@example.com", role: "ADMIN" as any },
    });
    const put = await storageSvc.putFile({
      body: Buffer.from("zip2"),
      contentType: "application/zip",
    });
    const bundle = await prisma.bundle.create({
      data: {
        name: "E2E Cooldown",
        storagePath: put.storageKey,
        checksum: put.storageEtag ?? put.sha256,
        description: "",
        createdBy: admin.id,
      },
    });
    const recipient = await prisma.recipient.create({
      data: { email: "e2e.cooldown.rec@example.com", createdBy: admin.id },
    });
    await prisma.bundleAssignment.create({
      data: {
        bundleId: bundle.id,
        recipientId: recipient.id,
        isEnabled: true,
        verificationType: null,
        verificationMet: true,
        maxDownloads: null,
        cooldownSeconds: 1,
        createdBy: admin.id,
      },
    });
    await prisma.recipientSession.create({
      data: {
        recipientId: recipient.id,
        jti: "sess-cooldown-1",
        expiresAt: futureDate(),
        ip: "127.0.0.1",
      },
    });

    const hDl = handlers.get("GET /portal/bundles/:bundleId")!;
    // First download
    const r1 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-cooldown-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      r1.res,
    );
    expect(r1.status).toBe(200);
    expect(r1.streamed).toBe(true);
    // Immediate second should 429
    const r2 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-cooldown-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      r2.res,
    );
    expect(r2.status).toBe(429);
    expect(r2.body?.code).toBe("COOLDOWN_ACTIVE");
    // Wait for cooldown to pass
    await new Promise((r) => setTimeout(r, 1200));
    const r3 = createResponseCapture();
    await hDl(
      {
        headers: { cookie: "lf_recipient_sess=sess-cooldown-1" },
        params: { bundleId: bundle.id },
      } as unknown as RequestLike,
      r3.res,
    );
    expect(r3.status).toBe(200);
    expect(r3.streamed).toBe(true);
  });
});
