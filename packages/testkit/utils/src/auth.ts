export type Role = "admin" | "recipient" | "cli";

export interface AuthState {
  admin: boolean;
  recipient: boolean;
  cli: boolean;
}

export const defaultAuthState: AuthState = { admin: true, recipient: true, cli: true };

export class AuthGates {
  state: AuthState;
  constructor(initial?: Partial<AuthState>) {
    this.state = { ...defaultAuthState, ...(initial || {}) };
  }
  require(role: Role) {
    if (!this.state[role]) {
      interface AuthError extends Error {
        status?: number;
        code?: string;
      }
      const err = new Error("Unauthorized") as AuthError;
      err.status = 401;
      err.code = "UNAUTHORIZED";
      throw err;
    }
  }
  set(role: Role, allowed: boolean) {
    this.state[role] = allowed;
  }
}
