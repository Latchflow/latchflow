# PLAN.md — CLI Authentication (Device Code Flow + API Tokens)

## Objective
Add CLI authentication to 'packages/core' using:
- A **device code** flow (human approves in browser or via API)
- Long-lived **API tokens** (opaque, hashed in DB) used by the CLI via 'Authorization: Bearer'

## Deliverables
- Prisma models:
  - 'ApiToken' (hashed tokens with scopes + TTL + revoke)
  - 'DeviceAuth' (device_code + user_code, approval state)
- Config additions for device code + token lifetimes
- Routes (all JSON):
  - 'POST /auth/cli/device/start' → begin device code flow
  - 'POST /auth/cli/device/approve' → approve a user_code (admin UI or curl)
  - 'POST /auth/cli/device/poll' → CLI polls; returns API token when approved
  - 'GET  /auth/cli/tokens' → list caller's tokens (admin/executor)
  - 'POST /auth/cli/tokens/revoke' → revoke a token by id
- Middleware:
  - 'requireApiToken(scopes?: string[])' — validates Bearer token and attaches 'req.user'
- Utilities:
  - Token generator & SHA-256 hasher (reuse existing 'auth/tokens.ts')
  - Scope checking helper
- Tests for the happy paths + failure cases

## Prisma (add models)
Append to 'packages/db/prisma/schema.prisma' and migrate:

'model ApiToken {
  id         String    @id @default(uuid())
  userId     String
  user       User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String
  scopes     String[]  // e.g. ["core:read", "core:write"]
  tokenHash  String    @unique
  createdAt  DateTime  @default(now())
  lastUsedAt DateTime?
  expiresAt  DateTime?
  revokedAt  DateTime?
  @@index([userId])
}

model DeviceAuth {
  id            String   @id @default(uuid())
  // Optional: set after we upsert/find the user by email at start time
  userId        String?
  user          User?    @relation(fields: [userId], references: [id], onDelete: Cascade)
  email         String
  deviceName    String?
  deviceCodeHash String  @unique
  userCodeHash   String  @unique
  intervalSec    Int      @default(5)
  createdAt      DateTime @default(now())
  expiresAt      DateTime
  approvedAt     DateTime?
  tokenId        String?
  token          ApiToken? @relation(fields: [tokenId], references: [id], onDelete: SetNull)
}'

Then:
- 'pnpm run env:load pnpm -F db exec prisma migrate dev'
- 'pnpm run env:load pnpm -F db exec prisma generate'

## Config ('packages/core/src/config.ts')
Add zod-validated envs (with defaults):
- 'DEVICE_CODE_TTL_MIN' (default '10')
- 'DEVICE_CODE_INTERVAL_SEC' (default '5')
- 'API_TOKEN_TTL_DAYS' (optional, e.g. '')
- 'API_TOKEN_SCOPES_DEFAULT' (default '["core:read","core:write"]')
- 'API_TOKEN_PREFIX' (default 'lfk_') // only for formatting the raw token string

## Files to create (core)
- 'src/routes/auth/cli.ts'
- 'src/middleware/require-api-token.ts'
- 'src/auth/scopes.ts' (scope check helper)
- Wire into 'src/index.ts' (mount '/auth/cli' routes)

## Route specs

'POST /auth/cli/device/start'
- Body: '{ email: string, deviceName?: string }'
- Behavior:
  - Upsert/find 'User' by email (this is your admin/executor user set).
  - Generate:
    - 'device_code' (long, random; store 'sha256Hex' as 'deviceCodeHash')
    - 'user_code' (short, human-friendly like 'ABCD-1234'; store hash)
  - Create 'DeviceAuth' with '{ userId, email, deviceName, intervalSec, expiresAt = now + DEVICE_CODE_TTL_MIN }'
  - Return:
    '{ device_code, user_code, verification_uri, expires_in, interval }'
    - 'verification_uri' can point to your admin UI (/cli/device/approve) or be an API path the user can hit in cURL/postman.

'POST /auth/cli/device/approve'
- Body: '{ user_code: string }'
- Behavior:
  - Find 'DeviceAuth' by 'userCodeHash', ensure not expired, not approved.
  - Ensure the associated 'User' has a role that’s allowed to obtain CLI tokens (e.g., ADMIN/EXECUTOR).
  - Create 'ApiToken' with:
    - 'userId', 'name' = 'deviceName' or 'CLI Token', 'scopes' = API_TOKEN_SCOPES_DEFAULT
    - 'token' = random opaque string (prefix with API_TOKEN_PREFIX)
    - 'tokenHash' = sha256Hex(token)
    - 'expiresAt' if 'API_TOKEN_TTL_DAYS' set
  - Mark 'DeviceAuth.approvedAt = now' & 'tokenId' = new token id.
  - Response: 204 (do not return the token here; CLI will get it via poll).

'POST /auth/cli/device/poll'
- Body: '{ device_code: string }'
- Behavior:
  - Find 'DeviceAuth' by 'deviceCodeHash', check not expired.
  - If not 'approvedAt', return 428 (or 202) with '{ status: "pending", interval }'.
  - If approved, fetch 'ApiToken' by 'tokenId' and return:
    '{ access_token: "<raw token>", token_type: "bearer", expires_at?: ISO, scopes: string[] }'
  - Optional: one-shot the poll (delete DeviceAuth after success).

'GET /auth/cli/tokens'
- Auth: 'requireAdmin' or 'requireApiToken(["core:read"])' if you want tokens to manage themselves.
- Returns caller’s tokens: id, name, scopes, createdAt, lastUsedAt, expiresAt, revokedAt.

'POST /auth/cli/tokens/revoke'
- Body: '{ tokenId: string }'
- Auth: 'requireAdmin' (or the token’s owner).
- Sets 'revokedAt = now'.

## Middleware

'// src/middleware/require-api-token.ts'
- Read 'Authorization: Bearer <token>'.
- Validate format; hash with sha256; lookup 'ApiToken' by 'tokenHash'.
- Ensure not revoked, not expired; update 'lastUsedAt'.
- Load 'user' and ensure roles are allowed for the route if required.
- Attach 'req.user', 'req.apiToken', and a 'hasScope(scope)' helper.

## Utilities

Extend 'src/auth/tokens.ts' (or create if missing):
- 'randomTokenBase64Url(bytes: number): string' (e.g., 32 bytes)
- 'formatApiToken(prefix, raw): string' // returns 'lfk_' + base64url
- 'sha256Hex(str: string): string'
- 'makeUserCode(): string' // e.g., 4+4 alnum with dash
- 'makeDeviceCode(): string' // 32-48 char base64url

## Security notes
- Always store **hashes** of API tokens and device codes; return raw tokens only once.
- Enforce role checks on approval: only users with required roles can mint tokens.
- Rate-limit 'device/start' and 'device/poll' by IP/email; add small backoff on poll (respect 'interval').
- Return generic errors; never disclose which emails are valid.
- Log token ids (not raw tokens); at most last 4 chars of raw tokens in debug.

## Tests
- Device code happy path: start → approve → poll returns token → use token on a protected endpoint.
- Poll before approve returns 202/428 with 'interval'.
- Expired device code → 400/410.
- Revoke token → subsequent API calls with that token get 401.
- Token expiry (if configured) → 401 after time advance.
- Scope check: route requiring 'core:write' rejects token with only 'core:read'.

## Wire-up
- Mount '/auth/cli' routes in 'src/index.ts' under the existing Express adapter.
- Keep existing web session auth (cookies) unchanged; CLI uses only Bearer tokens.
