export const config = {
  coreApiUrl: process.env.NEXT_PUBLIC_CORE_API_URL || "http://localhost:3001",
  sessionCookieName: process.env.NEXT_PUBLIC_SESSION_COOKIE_NAME || "lf_recipient_sess",
} as const;
