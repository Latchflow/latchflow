# PLAN.md — Add Authentication (Magic Link for Admins, OTP for Recipients)

## Objective
Implement lightweight authentication and authorization in 'packages/core' using:
- Magic-link login for Admin/Executor users (based on existing 'User.roles')
- OTP-per-bundle login for Recipients (no persistent account)
- Server-side sessions stored in Postgres
- HTTP-only cookies for session state
- Role-based middleware for admin routes and bundle-scoped middleware for portal routes

## Deliverables
- Prisma models (sessions/tokens) and migration
- Config additions for auth behavior and cookie settings
- Routes:
  - 'POST /auth/admin/start', 'GET /auth/admin/callback', 'POST /auth/admin/logout', 'GET /auth/me'
  - 'POST /auth/recipient/start', 'POST /auth/recipient/verify', 'POST /auth/recipient/logout'
- Middleware:
  - 'requireAdmin' (checks user session + role)
  - 'requireRecipient(bundleScoped?: boolean)' (checks recipient session and bundle scope)
- Utility helpers:
  - Token generator and SHA-256 hashing
  - OTP generator and attempt/lockout handling
  - Cookie set/clear utilities with secure defaults
- Tests covering the happy paths and common failures

## Prisma (add models; reuse existing 'User' with 'roles')
Add to 'packages/db/prisma/schema.prisma' and run migrate:

'model Session {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  jti        String   @unique
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  revokedAt  DateTime?
  ip         String?
  userAgent  String?
  @@index([userId, expiresAt])
}

model MagicLink {
  id         String   @id @default(uuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  tokenHash  String   @unique
  createdAt  DateTime @default(now())
  expiresAt  DateTime
  consumedAt DateTime?
}

model RecipientSession {
  id          String   @id @default(uuid())
  recipientId String
  bundleId    String
  jti         String   @unique
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  revokedAt   DateTime?
  ip          String?
  userAgent   String?
  @@index([recipientId, bundleId])
}

model RecipientOtp {
  id          String   @id @default(uuid())
  recipientId String
  bundleId    String
  codeHash    String
  createdAt   DateTime @default(now())
  expiresAt   DateTime
  attempts    Int      @default(0)
  @@index([recipientId, bundleId])
}'

## Config ('packages/core/src/config.ts')
Add zod-validated envs (with sensible defaults):
- 'AUTH_COOKIE_DOMAIN' (optional)
- 'AUTH_SESSION_TTL_HOURS' (default '12')
- 'ADMIN_MAGICLINK_TTL_MIN' (default '15')
- 'RECIPIENT_OTP_TTL_MIN' (default '10')
- 'RECIPIENT_OTP_LENGTH' (default '6')
- 'AUTH_COOKIE_SECURE' (default 'true' in non-dev)
Cookie names (constants):
- 'lf_admin_sess', 'lf_recipient_sess'

## Files to create (core)
- 'src/routes/auth/admin.ts'
- 'src/routes/auth/recipient.ts'
- 'src/middleware/require-admin.ts'
- 'src/middleware/require-recipient.ts'
- 'src/auth/tokens.ts' (random string, sha256 hash, otp generator)
- 'src/auth/cookies.ts' (set/clear helpers, common cookie options)
- Wire registration in 'src/index.ts' to mount the routes

## Route specs

'POST /auth/admin/start'
- Body: '{ email: string }'
- Behavior: upsert or find 'User' by email; create 'MagicLink' with 'tokenHash' (sha256 of a random token) and 'expiresAt' (now + ADMIN_MAGICLINK_TTL_MIN). Send email containing callback URL with raw token. In dev, log to console or MailHog.
- Response: 204 (no content)

'GET /auth/admin/callback?token=...'
- Behavior: sha256(token) → find valid 'MagicLink' (not expired, not consumed). If found, mark consumed, create 'Session' with 'jti' (random), 'expiresAt' (now + AUTH_SESSION_TTL_HOURS). Set 'lf_admin_sess' cookie (HttpOnly, SameSite=Lax, Secure on TLS, Domain if configured). Redirect to admin UI origin (configurable) or return 204 JSON if no UI redirect is set.

'POST /auth/admin/logout'
- Behavior: read 'lf_admin_sess', revoke session (set 'revokedAt'), clear cookie.
- Response: 204

'GET /auth/me'
- Behavior: requires admin session; returns '{ user: { id, email, roles }, session: { expiresAt } }'

'POST /auth/recipient/start'
- Body: '{ recipientId: string, bundleId: string }'
- Behavior: verify that recipient is assigned to bundle (DB check). Generate numeric OTP (length RECIPIENT_OTP_LENGTH), store 'RecipientOtp' with 'codeHash' and 'expiresAt' (now + RECIPIENT_OTP_TTL_MIN), reset attempts. Email OTP to recipient's email (or log in dev).
- Response: 204

'POST /auth/recipient/verify'
- Body: '{ recipientId: string, bundleId: string, otp: string }'
- Behavior: lookup 'RecipientOtp' row, check expiry and 'attempts' < threshold (e.g., 5). If wrong, increment attempts; if correct, create 'RecipientSession' with 'jti' and expiry (shorter, e.g., 2 hours), delete or invalidate the OTP row. Set 'lf_recipient_sess' cookie.
- Response: 204

'POST /auth/recipient/logout'
- Behavior: read 'lf_recipient_sess', revoke 'RecipientSession', clear cookie.
- Response: 204

## Middleware

'// src/middleware/require-admin.ts'
- Reads 'lf_admin_sess' cookie
- Loads 'Session' with 'user'; checks not expired, not revoked
- Checks 'user.roles' includes 'ADMIN' or 'EXECUTOR' (use your actual role strings)
- Attaches 'req.user' and 'req.roles'; else 401/403

'// src/middleware/require-recipient.ts'
- Reads 'lf_recipient_sess' cookie
- Loads 'RecipientSession'; checks not expired, not revoked
- If 'bundleScoped' and route has ':bundleId', ensure it matches session.bundleId
- Attaches 'req.recipientSession'; else 401/403

## Utilities

'// src/auth/tokens.ts'
- 'randomToken(len?: number): string' (url-safe)
- 'sha256Hex(str: string): string'
- 'genOtp(digits: number): string' (numeric)

'// src/auth/cookies.ts'
- 'setCookie(res, name, value, { maxAgeSec })' with 'HttpOnly', 'SameSite=Lax', 'Secure' (unless explicitly disabled in dev), 'Path=/'
- 'clearCookie(res, name)'

## Security notes
- Store only **hashes** of magic links and OTPs (sha256)
- Enforce TTLs and consume magic links on first use
- Rate limit OTP verification and start endpoints (basic in-memory limiter is fine for MVP)
- Never echo raw tokens in logs; only last 4 chars if needed
- Cookies: HttpOnly + SameSite=Lax + Secure (in TLS). Allow 'AUTH_COOKIE_DOMAIN' if you need cross-subdomain cookies.

## Steps for Codex
1) Add Prisma models and run:
   - 'pnpm run env:load pnpm -F db exec prisma migrate dev'
   - 'pnpm run env:load pnpm -F db exec prisma generate'
2) Update 'src/config.ts' to include new auth envs and defaults.
3) Create 'src/auth/tokens.ts' and 'src/auth/cookies.ts'.
4) Implement middleware 'require-admin.ts' and 'require-recipient.ts'.
5) Implement routes in 'src/routes/auth/admin.ts' and 'src/routes/auth/recipient.ts' with zod validation and proper responses.
6) Register the routes in 'src/index.ts' (mount paths under '/auth/...').
7) Add unit tests:
   - Magic link flow: start → callback → me → logout (role-gated admin route returns 200 then 401 after logout)
   - OTP flow: start → verify → protected portal route allowed → logout → route blocked
   - Failure cases: expired token/otp, wrong otp increments attempts, non-admin roles denied
8) Update any README or API docs section for the new endpoints (optional for MVP).

## Acceptance checklist
- 'POST /auth/admin/start' returns 204 and creates a valid 'MagicLink'
- 'GET /auth/admin/callback' sets 'lf_admin_sess' and creates 'Session'; 'GET /auth/me' returns user with roles
- Admin-only route guarded by 'requireAdmin' returns 403 for users without required roles
- 'POST /auth/recipient/start' generates and stores OTP for a valid (recipient, bundle)
- 'POST /auth/recipient/verify' sets 'lf_recipient_sess' and creates 'RecipientSession'
- 'requireRecipient(true)' blocks access when session bundle doesn't match route ':bundleId'
- Logout endpoints revoke sessions and clear cookies
- All new tests pass with 'pnpm -F core test'
