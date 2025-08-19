import { vi } from "vitest";

// Provide a virtual mock for the Prisma client package so tests that import
// modules which transitively import '@latchflow/db' don't attempt to resolve
// a real package entry in CI.
// vitest supports a third `{ virtual: true }` argument at runtime, but types don't.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - virtual mock for non-existent module
vi.mock("@latchflow/db", () => ({ prisma: {} }), { virtual: true });
