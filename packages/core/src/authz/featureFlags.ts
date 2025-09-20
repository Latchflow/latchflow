export type AuthzMode = "off" | "shadow" | "enforce";

let mode: AuthzMode = "off";
let requireAdmin2fa = false;
let reauthWindowMs = 15 * 60 * 1000;
let systemUserId = "system";

export function configureAuthzFlags(options: {
  enforce?: boolean;
  shadow?: boolean;
  requireAdmin2fa?: boolean;
  reauthWindowMin?: number;
  systemUserId?: string;
}) {
  if (options.enforce) mode = "enforce";
  else if (options.shadow) mode = "shadow";
  else mode = "off";
  requireAdmin2fa = options.requireAdmin2fa ?? false;
  if (options.reauthWindowMin != null) {
    reauthWindowMs = Math.max(1, options.reauthWindowMin) * 60 * 1000;
  }
  if (options.systemUserId) {
    systemUserId = options.systemUserId;
  }
}

export function getAuthzMode(): AuthzMode {
  return mode;
}

export function isAdmin2faRequired(): boolean {
  return requireAdmin2fa;
}

export function getReauthWindowMs(): number {
  return reauthWindowMs;
}

export function resetAuthzFlags() {
  mode = "off";
  requireAdmin2fa = false;
  reauthWindowMs = 15 * 60 * 1000;
  systemUserId = "system";
}

export function getSystemUserId(): string {
  return systemUserId;
}
