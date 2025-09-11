// Vitest global setup for E2E: start containers once per run
import path from "node:path";

export default async function () {
  // Use relative path to avoid relying on aliasing at global-setup time
  const { startAll, stopAll } = await import(path.join(__dirname, "../helpers/containers.ts"));

  const env = await startAll();
  (globalThis as any).__E2E_ENV__ = env;
  process.env.DATABASE_URL = env.postgres.url;
  process.env.SMTP_URL = `${env.mailhog.smtpUrl}?ignoreTLS=true`;
  process.env.SMTP_FROM = "no-reply@e2e.local";
  // Expose full E2E env via process env for worker contexts
  process.env.E2E_POSTGRES_URL = env.postgres.url;
  process.env.E2E_POSTGRES_HOST = String(env.postgres.host);
  process.env.E2E_POSTGRES_PORT = String(env.postgres.port);
  process.env.E2E_POSTGRES_USER = env.postgres.user;
  process.env.E2E_POSTGRES_PASSWORD = env.postgres.password;
  process.env.E2E_POSTGRES_DB = env.postgres.database;
  process.env.E2E_MINIO_ENDPOINT = env.minio.endpoint;
  process.env.E2E_MINIO_PRESIGN_ENDPOINT = env.minio.presignEndpoint;
  process.env.E2E_MINIO_ACCESS_KEY_ID = env.minio.accessKeyId;
  process.env.E2E_MINIO_SECRET_ACCESS_KEY = env.minio.secretAccessKey;
  process.env.E2E_MINIO_REGION = env.minio.region;
  process.env.E2E_MINIO_BUCKET = env.minio.bucket;
  process.env.E2E_MINIO_FORCE_PATH_STYLE = String(env.minio.forcePathStyle ?? true);
  process.env.E2E_MAILHOG_SMTP_URL = env.mailhog.smtpUrl;
  process.env.E2E_MAILHOG_HTTP_URL = env.mailhog.httpUrl;

  return async () => {
    await stopAll();
    delete (globalThis as any).__E2E_ENV__;
  };
}
