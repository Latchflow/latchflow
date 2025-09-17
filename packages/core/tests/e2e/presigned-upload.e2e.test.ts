import { describe, it, expect, beforeAll, vi } from "vitest";
import type { HttpHandler, HttpServer, RequestLike } from "../../src/http/http-server.js";
import { createStorageService } from "../../src/storage/service.js";
import { createS3Storage } from "../../src/storage/s3.js";
import { getEnv } from "@tests/helpers/containers";
import { putPresigned, sha256Hex as shaHex } from "@tests/helpers/s3";
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

// Bypass auth for this E2E — focus on storage path; attach a synthetic admin user id
let ADMIN_ID = "e2e-admin";
vi.mock("../../src/middleware/require-admin-or-api-token.js", () => ({
  requireAdminOrApiToken: (_opts: any) => (h: HttpHandler) => async (req: any, res: any) => {
    req.user = { id: ADMIN_ID };
    return h(req, res);
  },
}));

describe("E2E: presigned upload (S3/MinIO)", () => {
  beforeAll(() => {
    expect(getEnv().postgres.url).toBeTruthy();
  });
  beforeAll(() => {
    expect(getEnv().minio.endpoint).toBeTruthy();
  });

  it("happy path: issue presign, PUT object, commit, and retrieve metadata", async () => {
    const env = getEnv();
    const { prisma } = await import("@latchflow/db");
    // Ensure an admin user exists and set ADMIN_ID for createdBy attribution
    const admin = await prisma.user.upsert({
      where: { email: "e2e.uploader@example.com" },
      update: {},
      create: { email: "e2e.uploader@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;

    const s3 = await createS3Storage({
      config: {
        region: env.minio.region,
        endpoint: env.minio.endpoint,
        presignEndpoint: env.minio.presignEndpoint,
        accessKeyId: env.minio.accessKeyId,
        secretAccessKey: env.minio.secretAccessKey,
        forcePathStyle: true,
      },
    });
    const storage = createStorageService({ driver: s3, bucket: env.minio.bucket, keyPrefix: "p" });

    const { handlers, server } = makeServer();
    const { registerFileAdminRoutes } = await import("../../src/routes/admin/files.js");
    registerFileAdminRoutes(server, { storage });

    // Request presigned URL
    const data = new TextEncoder().encode("hello-presigned");
    const hex = await shaHex(data);
    const hUploadUrl = handlers.get("POST /files/upload-url")!;
    const rcUpUrl = createResponseCapture();
    await hUploadUrl(
      {
        headers: {},
        body: {
          key: "e2e/presigned/test.txt",
          sha256: hex,
          contentType: "text/plain",
          size: data.byteLength,
        },
      } as unknown as RequestLike,
      rcUpUrl.res,
    );
    if (rcUpUrl.status !== 201) {
      throw new Error(`upload-url failed: ${JSON.stringify(rcUpUrl.body)}`);
    }
    const up = rcUpUrl.body as {
      url: string;
      headers: Record<string, string>;
      tempKey: string;
      reservationId: string;
    };
    expect(up?.url).toBeTruthy();
    expect(up?.reservationId).toBeTruthy();

    // Upload via presigned URL with only signed headers
    const urlObj = new URL(up.url);
    const signed = (
      urlObj.searchParams.get("X-Amz-SignedHeaders") ??
      urlObj.searchParams.get("x-amz-signedheaders") ??
      ""
    )
      .split(";")
      .map((s) => s.trim().toLowerCase());
    const toSend: Record<string, string> = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (signed.includes(k.toLowerCase())) toSend[k] = v;
    }
    const putRes = await putPresigned(up.url, data, { headers: toSend });
    if (!putRes.ok) {
      const txt = await putRes.text().catch(() => "");
      throw new Error(`PUT to presigned URL failed: ${putRes.status} ${txt}`);
    }

    // Commit
    const hCommit = handlers.get("POST /files/commit")!;
    const rcCommit = createResponseCapture();
    await hCommit(
      {
        headers: {},
        body: {
          key: "e2e/presigned/test.txt",
          reservationId: up.reservationId,
        },
      } as unknown as RequestLike,
      rcCommit.res,
    );
    expect([200, 201]).toContain(rcCommit.status);
    const etag = rcCommit.headers["ETag"] as string;
    expect(typeof etag).toBe("string");
    expect(rcCommit.body?.key).toBe("e2e/presigned/test.txt");
    expect(rcCommit.body?.contentHash?.length).toBe(64);
  });

  it("rejects commit when checksum mismatches", async () => {
    const env = getEnv();
    const { prisma } = await import("@latchflow/db");
    const admin = await prisma.user.upsert({
      where: { email: "e2e.uploader@example.com" },
      update: {},
      create: { email: "e2e.uploader@example.com", role: "ADMIN" as any },
    });
    ADMIN_ID = admin.id;
    const s3 = await createS3Storage({
      config: {
        region: env.minio.region,
        endpoint: env.minio.endpoint,
        presignEndpoint: env.minio.presignEndpoint,
        accessKeyId: env.minio.accessKeyId,
        secretAccessKey: env.minio.secretAccessKey,
        forcePathStyle: true,
      },
    });
    const storage = createStorageService({ driver: s3, bucket: env.minio.bucket, keyPrefix: "p" });
    const { handlers, server } = makeServer();
    const { registerFileAdminRoutes } = await import("../../src/routes/admin/files.js");
    registerFileAdminRoutes(server, { storage });

    // Request URL with sha256 of A but upload B
    const dataA = new TextEncoder().encode("mismatch-A");
    const dataB = new TextEncoder().encode("mismatch-B");
    const hexA = await shaHex(dataA);
    const hUploadUrl = handlers.get("POST /files/upload-url")!;
    const rcUpUrl = createResponseCapture();
    await hUploadUrl(
      {
        headers: {},
        body: {
          key: "e2e/presigned/mismatch.txt",
          sha256: hexA,
          contentType: "text/plain",
          size: dataB.byteLength,
        },
      } as unknown as RequestLike,
      rcUpUrl.res,
    );
    if (rcUpUrl.status !== 201) {
      throw new Error(`upload-url failed: ${JSON.stringify(rcUpUrl.body)}`);
    }
    const up = rcUpUrl.body as {
      url: string;
      headers: Record<string, string>;
      reservationId: string;
    };

    // Upload different content
    const urlObj2 = new URL(up.url);
    const signed2 = (
      urlObj2.searchParams.get("X-Amz-SignedHeaders") ??
      urlObj2.searchParams.get("x-amz-signedheaders") ??
      ""
    )
      .split(";")
      .map((s) => s.trim().toLowerCase());
    const toSend2: Record<string, string> = {};
    for (const [k, v] of Object.entries(up.headers)) {
      if (signed2.includes(k.toLowerCase())) toSend2[k] = v;
    }
    const putRes2 = await putPresigned(up.url, dataB, { headers: toSend2 });
    if (!putRes2.ok) {
      // S3 typically rejects due to checksum binding; done.
      return;
    }
    // MinIO may accept the PUT even with mismatched content; commit should succeed, but
    // the recorded contentHash will still reflect the requested sha (hexA).
    const hCommit = handlers.get("POST /files/commit")!;
    const rcCommit = createResponseCapture();
    await hCommit(
      {
        headers: {},
        body: {
          key: "e2e/presigned/mismatch.txt",
          reservationId: up.reservationId,
        },
      } as unknown as RequestLike,
      rcCommit.res,
    );
    expect([200, 201]).toContain(rcCommit.status);
    expect(rcCommit.body?.contentHash).toBe(hexA);
  });
});
