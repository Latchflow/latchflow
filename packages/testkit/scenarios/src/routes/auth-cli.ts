import type { RouteDescriptor } from "../types.js";

export const cliDeviceStart = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/device/start",
  handler: () => ({
    status: 200,
    json: {
      deviceCode: "dev-123",
      userCode: "USER-CODE",
      verificationUri: "https://example.com/device",
      expiresIn: 600,
      interval: 5,
    },
  }),
});
export const cliDeviceApprove = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/device/approve",
  handler: () => ({ status: 200, json: { approved: true } }),
});
export const cliDevicePoll = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/device/poll",
  handler: () => ({ status: 200, json: { status: "pending" } }),
});
export const cliTokens = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/tokens",
  handler: () => ({
    status: 200,
    json: { accessToken: "at-123", refreshToken: "rt-123", tokenType: "Bearer", expiresIn: 3600 },
  }),
});
export const cliTokensRevoke = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/tokens/revoke",
  handler: () => ({ status: 204 }),
});
export const cliTokensRotate = (): RouteDescriptor => ({
  method: "POST",
  path: "/auth/cli/tokens/rotate",
  handler: () => ({
    status: 200,
    json: { accessToken: "at-rot", refreshToken: "rt-rot", tokenType: "Bearer", expiresIn: 3600 },
  }),
});
