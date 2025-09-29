import type { UserRole } from "@latchflow/db";

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
  assignRole(userId: string, role: UserRole, options?: UserRoleChangeOptions): Promise<void>;
  setActive(
    userId: string,
    isActive: boolean,
    options?: UserActivationChangeOptions,
  ): Promise<void>;
  revokeSessions(userId: string, options?: SessionRevokeOptions): Promise<number>;
}
