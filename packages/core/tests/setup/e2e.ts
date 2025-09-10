// E2E setup – starts/stops containers and prepares environment for E2E tests only.
// Keep unit/integration setup in tests/setup/global.ts to avoid container overhead.
import { beforeAll, afterAll } from "vitest";
import { startAll, stopAll, getEnv } from "@tests/helpers/containers";

declare global {
  // eslint-disable-next-line no-var
  var __E2E_ENV__: ReturnType<typeof getEnv> | undefined;
}

beforeAll(async () => {
  const env = await startAll();
  globalThis.__E2E_ENV__ = env;
  // Point process envs as needed for code under test
  process.env.DATABASE_URL = env.postgres.url;
  // Hint nodemailer to skip STARTTLS in test env
  process.env.SMTP_URL = `${env.mailhog.smtpUrl}?ignoreTLS=true`;
  process.env.SMTP_FROM = "no-reply@e2e.local";
});

afterAll(async () => {
  await stopAll();
  globalThis.__E2E_ENV__ = undefined;
});

export {};
