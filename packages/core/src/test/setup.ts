// Global test setup is intentionally minimal. Prisma client is mocked via
// an alias in vitest.config.ts that points @latchflow/db to src/test/prisma-mock.ts
// so runtime code that imports getDb() -> @latchflow/db will receive the mock.
export {};
