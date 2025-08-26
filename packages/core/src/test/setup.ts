import { vi } from "vitest";

// Provide a richer virtual mock for the Prisma client used by Core services.
// Tests can configure stubs via getDb() (which returns prisma), e.g.,
//   const db = getDb() as any; db.session.findUnique.mockResolvedValueOnce(...)
const mkModel = () => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  delete: vi.fn(),
});

const prisma = {
  session: mkModel(),
  user: mkModel(),
  magicLink: mkModel(),
  deviceAuth: mkModel(),
  apiToken: mkModel(),
  recipientSession: mkModel(),
  recipient: mkModel(),
  bundleAssignment: mkModel(),
  triggerEvent: mkModel(),
  actionInvocation: mkModel(),
  pipeline: mkModel(),
  pipelineStep: mkModel(),
  pipelineTrigger: mkModel(),
  bundle: mkModel(),
  bundleObject: mkModel(),
  triggerDefinition: mkModel(),
  actionDefinition: mkModel(),
  changeLog: mkModel(),
};

// vitest supports a third `{ virtual: true }` argument at runtime, but types don't.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-expect-error - virtual mock for non-existent module
vi.mock("@latchflow/db", () => ({ prisma }), { virtual: true });
