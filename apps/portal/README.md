# Latchflow Portal

Recipient-facing web application for accessing and downloading secure file bundles.

## Features

- **Magic-link authentication**: Email-based OTP login (no passwords)
- **Bundle management**: View assigned bundles with download limits and cooldowns
- **Bulk downloads**: Select and download multiple bundles sequentially
- **Real-time cooldowns**: Live countdown timers for bundle availability
- **Download tracking**: Visual progress indicators and per-bundle status

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript (strict mode)
- **Styling**: Tailwind CSS v4
- **UI Components**: shadcn/ui
- **Data Fetching**: TanStack Query (React Query)
- **HTTP Client**: Axios
- **Toast Notifications**: Sonner
- **Type Generation**: openapi-typescript (@latchflow/api-types)

## Prerequisites

- Node.js 20+
- pnpm 9/10
- Latchflow Core API running (default: `http://localhost:3001`)

## Setup

1. **Install dependencies** (from repo root):
   ```bash
   pnpm install
   ```

2. **Configure environment** (optional):
   ```bash
   cd apps/portal
   cp .env.example .env
   ```

   Available environment variables:
   - `NEXT_PUBLIC_CORE_API_URL`: Core API base URL (default: `http://localhost:3001`)
   - `NEXT_PUBLIC_SESSION_COOKIE_NAME`: Session cookie name (default: `lf_recipient_sess`)

3. **Start the portal**:
   ```bash
   pnpm -F portal dev
   ```

   The portal will be available at `http://localhost:3002`

## Visual Comparison Workflow

Capture up-to-date renders for the key portal states and compare them with the mockups under `apps/portal/renders`:

```bash
pnpm -F portal visual:capture           # capture every scenario
pnpm -F portal visual:capture -- login  # capture a single scenario
pnpm -F portal visual:capture -- list   # list available scenarios
```

Each run builds the portal (`pnpm run build`) and serves it with `next start` (via `pnpm run start:visual`) to avoid hot-reload restarts while screenshots are being written. The script automatically selects an open port (default `4300`); set `PORTAL_VISUAL_SKIP_BUILD=1` if you have already built the app and want a faster iteration loop, or override `PORTAL_VISUAL_COMMAND`/`PORTAL_VISUAL_BUILD_COMMAND`/`PORTAL_VISUAL_PORT` to use a custom server/build/port.

When the script runs for the first time it will automatically download the required Playwright Chromium browser. If Playwright prompts for additional system packages (e.g. `install-deps`), follow the printed instructions once, then rerun the capture command. Updated screenshots land in `apps/portal/renders/current` and diffs (when a baseline exists) are written to `apps/portal/renders/diff`.

The capture script aligns the browser viewport to each baseline image automatically. If a baseline and the current render have different dimensions, the script skips the diff, saves the latest render under `renders/diff`, and logs the dimensions so you can decide whether to update the baseline or adjust the layout.

## API Endpoints Used

The portal interacts with the following Core API endpoints:

### Authentication
- `POST /auth/recipient/start` - Request OTP code
  - Body: `{ email: string }`
  - Response: `204 No Content`

- `POST /auth/recipient/verify` - Verify OTP and create session
  - Body: `{ email: string, otp: string }`
  - Response: `204 No Content` + `Set-Cookie: lf_recipient_sess=...`

- `POST /portal/auth/otp/resend` - Resend OTP code
  - Body: `{ email: string }`
  - Response: `204 No Content`

### Bundle Access
- `GET /portal/bundles` - List bundles with embedded assignment status
  - Response:
    ```json
    {
      "items": [
        {
          "assignmentId": "uuid",
          "assignmentUpdatedAt": "2024-01-01T00:00:00.000Z",
          "bundle": {
            "id": "uuid",
            "name": "string",
            "description": null,
            "storagePath": null,
            "checksum": null,
            "createdAt": "2024-01-01T00:00:00.000Z",
            "updatedAt": "2024-01-01T00:00:00.000Z"
          },
          "summary": {
            "bundleId": "uuid",
            "name": "string",
            "maxDownloads": null,
            "downloadsUsed": 0,
            "downloadsRemaining": null,
            "cooldownSeconds": null,
            "lastDownloadAt": null,
            "nextAvailableAt": null,
            "cooldownRemainingSeconds": 0
          }
        }
      ]
    }
    ```

- `GET /portal/bundles/{bundleId}` - Download bundle archive
  - Response: `application/octet-stream` (zip file) or `302` redirect

## Project Structure

```
apps/portal/
├── app/                    # Next.js App Router
│   ├── layout.tsx         # Root layout with QueryProvider
│   ├── page.tsx           # Home page (bundles list)
│   └── login/
│       └── page.tsx       # Login page
├── components/            # React components
│   ├── ui/               # shadcn/ui components
│   ├── bundles-list.tsx  # Main bundles list
│   ├── bundle-row.tsx    # Single bundle row
│   └── download-bar.tsx  # Progress bar
├── hooks/                # Custom React hooks
│   ├── use-assignments.ts      # React Query hook
│   ├── use-cooldown.ts        # Countdown timer
│   └── use-download-queue.ts  # Download orchestration
├── lib/                  # Utilities
│   ├── api-client.ts    # HTTP client
│   ├── config.ts        # Environment config
│   ├── format.ts        # Formatting helpers
│   └── query-client.tsx # React Query provider
└── middleware.ts        # Session guard
