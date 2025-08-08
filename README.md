# Latchflow

Trigger-gated secure file release system — store encrypted bundles and release them only when specific conditions are met.

```
Trigger -> Action
```

Latchflow began as a “digital legacy” tool — a way to pass files to specific people after your death — but its trigger-driven architecture makes it useful for many other release scenarios: timed publishing, workflow automation, or conditional data sharing.

## Core Concepts
  - Bundles — Secure sets of files assigned to recipients.
  - Recipients — People or endpoints allowed to retrieve specific bundles.
  - Triggers — Events that start a release process (cron schedules, webhooks, manual overrides, dead-man’s switch, etc.).
  - Actions — What happens after a trigger (send email, publish signed URL, push webhook, etc.).
  - Executors — Humans with conditional admin powers to manage bundles or run actions.
  - Audit Log — Every trigger, action, and download is recorded.

## Features
  - 🔒 Encrypted at rest — optional per-bundle encryption keys.
  - 🔌 Plugin system — extend with new triggers, actions, or storage backends.
  - 📜 Full audit trail — track every event from trigger to download.
  - 🧩 Two-portal architecture —
    - Admin UI for owners/executors
    - Recipient Portal for file retrieval
    - Shared backend + DB
  - 🛠 CLI — manage bundles, triggers, actions headlessly.
  - 🚦 Verification & limits — OTP/passphrase, per-recipient download caps, rate throttling.

## Example Use Cases
- Digital legacy management — securely pass files and messages to loved ones after you pass away.
- Timed press releases — publish embargoed announcements exactly at a scheduled time.
- Contract or invoice release — only send documents once payment is confirmed via a webhook.
- Research data publishing — release datasets when an approval process completes.
- Event media drops — automatically send photo/video bundles after a live event concludes.

## Architecture Overview
```
TriggerDefinition ──▶ TriggerAction ──▶ ActionDefinition
       │                                    │
  PluginCapability (TRIGGER)          PluginCapability (ACTION)
```
- Dynamic plugin registry — no hard-coded trigger/action types.
- Separation of concerns — plugins handle business logic, core handles orchestration and audit.
- Pluggable — storage, triggers, and actions can be swapped or extended without touching core.
