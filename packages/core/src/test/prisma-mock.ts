import { vi } from "vitest";

// Local Prisma client mock used by tests via Vitest alias in vitest.config.ts.
const mkModel = () => ({
  findUnique: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  count: vi.fn(),
  delete: vi.fn(),
});

export const prisma = {
  $queryRaw: vi.fn(),
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
  plugin: mkModel(),
  pluginCapability: mkModel(),
};
