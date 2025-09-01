import type { RequestLike } from "../http/http-server.js";

export type AuthzContext = {
  userId: string;
  role: "ADMIN" | "EXECUTOR" | "UNKNOWN";
  isActive: boolean;
  // Common IDs extracted from params/body where relevant
  ids: Partial<{ bundleId: string; pipelineId: string; actionId: string; triggerId: string }>;
};

type WithUser = RequestLike & {
  user?: {
    id?: string;
    role?: string | null;
    isActive?: boolean;
  };
};

export function buildContext(req: WithUser): AuthzContext {
  const u = req.user;
  const ids: AuthzContext["ids"] = {};
  const p = (req.params ?? {}) as Record<string, string>;
  if (typeof p.bundleId === "string") ids.bundleId = p.bundleId;
  if (typeof p.pipelineId === "string") ids.pipelineId = p.pipelineId;
  if (typeof p.actionId === "string") ids.actionId = p.actionId;
  if (typeof p.triggerId === "string") ids.triggerId = p.triggerId;
  return {
    userId: u?.id ?? "",
    role: u?.role === "ADMIN" ? "ADMIN" : u?.role === "EXECUTOR" ? "EXECUTOR" : "UNKNOWN",
    isActive: u?.isActive !== false,
    ids,
  };
}
