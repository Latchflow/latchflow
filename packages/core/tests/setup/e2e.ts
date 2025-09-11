// E2E setup – starts/stops containers and prepares environment for E2E tests only.
// Keep unit/integration setup in tests/setup/global.ts to avoid container overhead.
import { beforeAll, afterAll } from "vitest";
import { startAll, stopAll, getEnv } from "@tests/helpers/containers";

declare global {
  // eslint-disable-next-line no-var
  var __E2E_ENV__: ReturnType<typeof getEnv> | undefined;
  // eslint-disable-next-line no-var
  var __E2E_SETUP_COUNT__: number | undefined;
}

beforeAll(async () => {
  // Increment global setup counter and start containers only on first entry
  globalThis.__E2E_SETUP_COUNT__ = (globalThis.__E2E_SETUP_COUNT__ ?? 0) + 1;
  if (!globalThis.__E2E_ENV__) {
    const env = await startAll();
    globalThis.__E2E_ENV__ = env;
  }
  const env = globalThis.__E2E_ENV__!;
  // Point process envs as needed for code under test
  process.env.DATABASE_URL = env.postgres.url;
  // Hint nodemailer to skip STARTTLS in test env
  process.env.SMTP_URL = `${env.mailhog.smtpUrl}?ignoreTLS=true`;
  process.env.SMTP_FROM = "no-reply@e2e.local";
});

afterAll(async () => {
  // Decrement counter and stop containers only when last suite finishes
  if (globalThis.__E2E_SETUP_COUNT__ != null) {
    globalThis.__E2E_SETUP_COUNT__ -= 1;
  }
  if ((globalThis.__E2E_SETUP_COUNT__ ?? 0) <= 0) {
    await stopAll();
    globalThis.__E2E_ENV__ = undefined;
    globalThis.__E2E_SETUP_COUNT__ = undefined;
  }
});

export {};
