# Plugin Runtime System

## Overview

Latchflow's plugin system enables extensible trigger and action execution through a secure, audited runtime. The system supports:

- **Triggers**: External events that initiate workflows (cron schedules, webhooks, etc.)
- **Actions**: Operations executed in response to triggers (send email, publish files, etc.)
- **Providers**: Service integrations for core capabilities (Gmail for email, S3 for storage, etc.)

## Architecture

### Core Components

#### Plugin Loader (`packages/core/src/plugins/plugin-loader.ts`)
- Discovers and loads plugins from `packages/plugins/*`
- Validates plugin contracts (required lifecycle methods)
- Registers capabilities with the runtime registry
- Supports hot-reloading during development

#### Runtime Registry (`PluginRuntimeRegistry`)
- Maintains executable references for all registered triggers and actions
- Creates scoped service contexts for each execution
- Tracks execution metrics and health status

#### Execution Runtimes
- **Trigger Runtime Manager**: Starts/stops trigger instances, handles config changes
- **Action Consumer**: Processes queued actions with concurrency control
- **Queue System**: FIFO message queue with retry support

### Plugin Structure

A plugin exports:

```javascript
export default {
  name: "@latchflow/plugin-example",
  capabilities: [
    {
      kind: "TRIGGER",
      key: "webhook",
      displayName: "Webhook Trigger",
      configSchema: { /* JSON schema */ }
    }
  ],
  providers: [
    {
      kind: "email",
      id: "gmail",
      displayName: "Gmail",
      configSchema: { /* JSON schema */ },
      defaults: { /* env-based defaults */ },
      async register({ services, config, logger }) {
        // Register provider with core services
      }
    }
  ],
  async dispose() {
    // Cleanup on shutdown
  }
}
```

## Trigger Lifecycle

### Registration & Startup
1. Admin creates a `TriggerDefinition` via API
2. Runtime manager loads the definition on startup or config change
3. Factory function creates trigger runtime instance
4. `start()` method is called to begin listening for events

### Event Emission
```javascript
const trigger = {
  async start() {
    // Set up event listener
    this.interval = setInterval(() => {
      // Emit event through services
      await this.services.emit({
        context: { /* trigger data */ },
        scheduledFor: new Date(),
        metadata: { /* optional */ }
      });
    }, 60000);
  },

  async stop() {
    clearInterval(this.interval);
  }
}
```

### Configuration Changes
Triggers can optionally implement `onConfigChange()`:

```javascript
const trigger = {
  async onConfigChange(newConfig) {
    // Update without full restart
    this.updateSchedule(newConfig.cron);
  }
}
```

If not implemented, the manager stops and restarts the trigger.

### Shutdown
1. Manager calls `stop()` on all running triggers
2. Optional `dispose()` is called for cleanup
3. Triggers are removed from the active registry

## Action Execution

### Queue Processing
1. Trigger event creates `TriggerEvent` record
2. Pipeline steps enqueue `ActionDefinition` IDs to queue
3. Action consumer processes messages with concurrency limits
4. Each execution creates an `ActionInvocation` record

### Execution Flow
```javascript
const action = {
  async execute({ config, secrets, payload, invocation }) {
    // Merge config (static) with payload (dynamic)
    const recipient = payload.to || config.defaultRecipient;

    // Execute action logic
    const result = await sendEmail({ to: recipient, ... });

    // Return result or retry instruction
    return {
      output: result,
      retry: { delayMs: 5000, reason: "Rate limited" } // optional
    };
  }
}
```

### Concurrency Control
- Default limit: 10 concurrent actions (configurable via `PLUGIN_ACTION_CONCURRENCY`)
- Slot-based system prevents overload
- Actions wait for available slots before executing

### Error Handling & Retries
- Actions can return `{ retry: { delayMs, reason } }` for transient failures
- Automatic exponential backoff for uncaught errors
- `FAILED_PERMANENT` status for non-retryable errors
- All retries create audit entries

## Core Services

Plugins access core capabilities through scoped services:

### Email Providers
```javascript
await services.core.emailProviders.register(
  { requestedScopes: ["email:send"] },
  {
    id: "my-provider",
    capabilityId: `${plugin.name}:email`,
    displayName: "My Provider",
    async send(request) {
      // Send email
      return { providerMessageId, acceptedRecipients };
    }
  }
);
```

### Storage Access
```javascript
const downloadUrl = await services.core.storage.createReleaseLink(
  { requestedScopes: ["storage:read"] },
  { bundleId, expiresIn: 3600 }
);
```

### User Administration
```javascript
await services.core.users.inviteUser(
  { requestedScopes: ["users:write"], actorId },
  { email, role: "EXECUTOR" }
);
```

## Configuration & Secrets

### Plugin Configuration
- Stored in `TriggerDefinition.config` or `ActionDefinition.config`
- AES-GCM encrypted at rest
- Decrypted before passing to runtime
- Validated against capability's `configSchema`

### Provider Configuration
- Stored in `SystemConfig` table
- Namespaced as `PLUGIN_{NAME}_PROVIDER_{ID}`
- Supports JSON objects/arrays
- Environment variables provide defaults
- Encrypted with same AES-GCM system

### Best Practices
- Use JSON schemas to validate configuration
- Store secrets in config, not environment variables
- Never log decrypted config or secrets
- Validate config in plugin before use

## Observability

### Audit Logging
Every plugin execution creates audit entries:

**Trigger Audit:**
```json
{
  "timestamp": "2025-10-06T...",
  "pluginName": "@latchflow/plugin-cron",
  "capabilityKey": "cron_schedule",
  "triggerDefinitionId": "...",
  "triggerEventId": "...",
  "phase": "SUCCEEDED"
}
```

**Action Audit:**
```json
{
  "timestamp": "2025-10-06T...",
  "pluginName": "@latchflow/core",
  "capabilityKey": "email.send",
  "actionDefinitionId": "...",
  "invocationId": "...",
  "phase": "STARTED",
  "attempt": 1
}
```

### Metrics (OpenTelemetry)
- `plugin_trigger_emit_total{plugin, capability, outcome}`
- `plugin_action_execution_total{plugin, capability, status}`
- `plugin_action_duration_ms{plugin, capability}`
- `plugin_service_call_total{plugin, service, outcome}`

### Health Monitoring
```bash
# Check plugin status
GET /admin/plugins/:id/status

# Check trigger status
GET /admin/triggers/:id/status

# Check action executions
GET /admin/actions/:id/executions

# Overall runtime health
GET /system/plugin-runtime/health
```

## Security Model

### Isolation
- Each plugin execution runs in its own context
- No shared state between plugin instances
- Config/secrets accessible only to owning plugin
- Service calls are scoped and audited

### Permission Scopes
Services require explicit scopes:
- `email:send` - Send emails via registered providers
- `users:read`, `users:write` - User administration
- `storage:read`, `storage:write` - File operations
- `bundles:toggle`, `pipelines:toggle` - Resource control

Future: Per-capability scope enforcement at registration time.

## Built-in Plugins

### Core System Plugin (`@latchflow/core`)
- **email.send**: Delivers email via registered providers or SMTP fallback
- Always registered, cannot be disabled
- Seeded on first startup

### Scheduled Trigger (`@latchflow/plugin-cron`)
- **cron**: Recurring schedules with cron expressions
- **one-time**: Single execution at specified time
- Config: `{ mode: "cron", cron: { expression: "0 * * * *" } }`

### Gmail Provider (`@latchflow/plugin-gmail`)
- Email provider using Gmail API
- OAuth2-based authentication
- Config: `{ clientId, clientSecret, refreshToken, sender }`
- Env vars: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, `GMAIL_SENDER`

## Development

### Creating a Plugin

1. **Create plugin directory:**
```bash
mkdir -p packages/plugins/my-plugin
cd packages/plugins/my-plugin
```

2. **Create package.json:**
```json
{
  "name": "@latchflow/plugin-my-plugin",
  "version": "0.0.0",
  "private": true,
  "main": "./index.js",
  "type": "module"
}
```

3. **Implement plugin contract:**
```javascript
// index.js
export default {
  name: "@latchflow/plugin-my-plugin",
  capabilities: [
    {
      kind: "ACTION",
      key: "my_action",
      displayName: "My Action",
      configSchema: {
        type: "object",
        properties: {
          apiKey: { type: "string" }
        },
        required: ["apiKey"]
      }
    }
  ],
  async dispose() {
    // Cleanup resources
  }
}
```

4. **Register factory:**
```javascript
import { PluginRuntimeRegistry } from "@latchflow/core";

registry.registerAction({
  pluginName: "@latchflow/plugin-my-plugin",
  pluginId: "plugin-id",
  capabilityId: "capability-id",
  capability: { /* ... */ },
  factory: async (context) => ({
    async execute({ config, payload }) {
      // Action logic
      return { output: { success: true } };
    }
  })
});
```

### Hot Reloading
Set `PLUGIN_HOT_RELOAD=true` to enable automatic reloading during development.

### Testing
See [testing.md](./testing.md) for plugin testing patterns.

## Troubleshooting

### Plugin Not Loading
- Check `packages/plugins/*` directory structure
- Verify `export default` in index.js
- Check startup logs for validation errors
- Ensure required dependencies are installed

### Trigger Not Starting
- Verify `TriggerDefinition.isEnabled = true`
- Check trigger runtime logs for start errors
- Validate config against schema
- Ensure plugin is registered in runtime

### Actions Not Executing
- Check queue is running (`startActionConsumer`)
- Verify `ActionDefinition.isEnabled = true`
- Check for config validation errors
- Review action invocation status in database

### Config Decryption Errors
- Verify encryption key is set: `ENCRYPTION_KEY` env var
- Check config was encrypted with same key
- Review audit logs for encryption errors

### Performance Issues
- Increase concurrency: `PLUGIN_ACTION_CONCURRENCY=20`
- Check for slow action executions in metrics
- Review database query performance
- Monitor queue backlog size

## API Reference

See OpenAPI specification for complete API documentation:
- `/admin/plugins` - Plugin management
- `/admin/triggers` - Trigger definitions
- `/admin/actions` - Action definitions
- `/admin/pipelines` - Pipeline configuration
