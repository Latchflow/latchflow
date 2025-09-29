import type { UserRole } from "@latchflow/db";
import type { PluginServiceContext } from "./context.js";

export interface UserActivationChangeOptions {
  actorId?: string;
  reason?: string;
  timestamp?: Date;
}

export interface UserRoleChangeOptions {
  actorId?: string;
  timestamp?: Date;
}

export interface SessionRevokeOptions {
  actorId?: string;
  revokeBefore?: Date;
  reason?: string;
}

export interface UserAdminService {
  assignRole(
    context: PluginServiceContext,
    userId: string,
    role: UserRole,
    options?: UserRoleChangeOptions,
  ): Promise<void>;
  setActive(
    context: PluginServiceContext,
    userId: string,
    isActive: boolean,
    options?: UserActivationChangeOptions,
  ): Promise<void>;
  revokeSessions(
    context: PluginServiceContext,
    userId: string,
    options?: SessionRevokeOptions,
  ): Promise<number>;
}
