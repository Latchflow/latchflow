# Cron Trigger Plugin

The Cron Trigger plugin (`@latchflow/plugin-cron`) provides scheduled workflow automation with both recurring and one-time execution modes.

## Features

- **Recurring schedules** using cron expressions
- **One-time execution** at a specific time
- **Timezone support** for cron expressions
- **Graceful reload** on configuration changes without downtime

## Installation

The cron plugin is built-in and automatically loaded on startup. No additional installation required.

## Configuration

### Trigger Definition Schema

```json
{
  "mode": "cron | one-time",
  "cron": {
    "expression": "* * * * *",
    "timezone": "UTC"
  },
  "oneTime": {
    "scheduledFor": "2025-12-31T23:59:59Z"
  }
}
```

### Cron Mode

Execute workflows on a recurring schedule using cron expressions.

**Required fields:**
- `mode`: `"cron"`
- `cron.expression`: Valid cron expression

**Optional fields:**
- `cron.timezone`: IANA timezone (default: `"UTC"`)

**Example - Every hour:**
```json
{
  "mode": "cron",
  "cron": {
    "expression": "0 * * * *",
    "timezone": "America/New_York"
  }
}
```

**Example - Business hours only:**
```json
{
  "mode": "cron",
  "cron": {
    "expression": "0 9-17 * * 1-5",
    "timezone": "UTC"
  }
}
```

#### Cron Expression Format

```
┌───────────── minute (0 - 59)
│ ┌───────────── hour (0 - 23)
│ │ ┌───────────── day of month (1 - 31)
│ │ │ ┌───────────── month (1 - 12)
│ │ │ │ ┌───────────── day of week (0 - 6) (Sunday = 0)
│ │ │ │ │
* * * * *
```

**Common patterns:**
- `* * * * *` - Every minute
- `0 * * * *` - Every hour
- `0 0 * * *` - Daily at midnight
- `0 9 * * 1-5` - Weekdays at 9 AM
- `0 0 1 * *` - First day of month
- `0 0 * * 0` - Every Sunday

### One-Time Mode

Execute a workflow once at a specific time.

**Required fields:**
- `mode`: `"one-time"`
- `oneTime.scheduledFor`: ISO 8601 timestamp

**Example:**
```json
{
  "mode": "one-time",
  "oneTime": {
    "scheduledFor": "2025-12-31T23:59:59Z"
  }
}
```

**Note:** One-time triggers automatically disable after execution.

## Usage

### Creating a Cron Trigger

#### Via API

```bash
# Create recurring trigger
POST /admin/triggers
Content-Type: application/json

{
  "name": "Hourly Email Report",
  "capabilityId": "<cron-capability-id>",
  "config": {
    "mode": "cron",
    "cron": {
      "expression": "0 * * * *"
    }
  },
  "isEnabled": true
}
```

```bash
# Create one-time trigger
POST /admin/triggers
Content-Type: application/json

{
  "name": "Year-End Batch",
  "capabilityId": "<cron-capability-id>",
  "config": {
    "mode": "one-time",
    "oneTime": {
      "scheduledFor": "2025-12-31T23:59:59Z"
    }
  },
  "isEnabled": true
}
```

#### Finding the Capability ID

```bash
# List all trigger capabilities
GET /admin/plugins

# Find the cron plugin and extract capability ID
# Look for: capabilities[].kind = "TRIGGER" and key = "cron_schedule"
```

### Connecting to Actions

Cron triggers execute pipeline steps when fired:

1. **Create the trigger** (as shown above)
2. **Create action definitions** for the work to perform
3. **Create a pipeline** linking trigger to actions

```bash
# Create pipeline
POST /admin/pipelines
{
  "name": "Hourly Report Pipeline",
  "isEnabled": true
}

# Link trigger to pipeline
POST /admin/pipelines/{pipelineId}/triggers
{
  "triggerId": "<cron-trigger-id>",
  "sortOrder": 1,
  "isEnabled": true
}

# Add action step
POST /admin/pipelines/{pipelineId}/steps
{
  "actionId": "<email-action-id>",
  "sortOrder": 1,
  "isEnabled": true
}
```

### Testing Trigger Execution

```bash
# Manually fire a trigger to test
POST /admin/triggers/{triggerId}/test-fire
{
  "context": {
    "to": "test@example.com",
    "subject": "Test Email"
  }
}
```

## Context Data

Cron triggers provide minimal context to downstream actions:

```json
{
  "timestamp": "2025-10-06T12:00:00Z",
  "scheduledFor": "2025-10-06T12:00:00Z",
  "mode": "cron"
}
```

Actions can merge this with their static configuration:

```javascript
// Action receives both config and trigger context
{
  config: {
    to: "default@example.com",
    subject: "Default Subject"
  },
  payload: {
    timestamp: "2025-10-06T12:00:00Z"
  }
}
```

## Monitoring

### Trigger Status

```bash
# Check if trigger is running
GET /admin/triggers/{triggerId}/status

Response:
{
  "status": "running",
  "lastFired": "2025-10-06T12:00:00Z",
  "nextScheduled": "2025-10-06T13:00:00Z"
}
```

### Trigger Events

```bash
# List recent trigger events
GET /admin/triggers/{triggerId}/events?limit=10

Response:
{
  "events": [
    {
      "id": "evt_123",
      "triggeredAt": "2025-10-06T12:00:00Z",
      "context": { ... },
      "status": "SUCCESS"
    }
  ]
}
```

### Audit Logs

Cron executions generate audit entries:

```json
{
  "timestamp": "2025-10-06T12:00:00Z",
  "pluginName": "@latchflow/plugin-cron",
  "capabilityKey": "cron_schedule",
  "triggerDefinitionId": "...",
  "phase": "STARTED"
}
```

## Configuration Updates

### Updating Cron Expression

```bash
PATCH /admin/triggers/{triggerId}
{
  "config": {
    "mode": "cron",
    "cron": {
      "expression": "0 */2 * * *"  # Every 2 hours
    }
  }
}
```

The trigger automatically reloads with the new schedule without downtime.

### Changing Timezone

```bash
PATCH /admin/triggers/{triggerId}
{
  "config": {
    "mode": "cron",
    "cron": {
      "expression": "0 9 * * 1-5",
      "timezone": "America/Los_Angeles"
    }
  }
}
```

### Disabling a Trigger

```bash
PATCH /admin/triggers/{triggerId}
{
  "isEnabled": false
}
```

The trigger stops immediately and removes itself from the runtime.

## Troubleshooting

### Trigger Not Firing

**Check trigger status:**
```bash
GET /admin/triggers/{triggerId}/status
```

**Common issues:**
- `isEnabled = false` - Trigger is disabled
- Invalid cron expression - Check logs for validation errors
- Timezone mismatch - Verify timezone is correct
- System clock drift - Ensure server time is accurate

### Cron Expression Validation

Test cron expressions before deploying:

```bash
# Use cron expression tester
# https://crontab.guru/

# Or validate via API
POST /admin/triggers/validate
{
  "config": {
    "mode": "cron",
    "cron": { "expression": "invalid" }
  }
}
```

### Missing Trigger Events

**Check trigger event history:**
```bash
GET /admin/triggers/{triggerId}/events?limit=50
```

**Verify pipeline is enabled:**
```bash
GET /admin/pipelines/{pipelineId}
# Check: isEnabled = true
```

**Check action definitions are enabled:**
```bash
GET /admin/pipelines/{pipelineId}/steps
# Verify: each step's action has isEnabled = true
```

### One-Time Trigger Didn't Execute

**Check scheduled time:**
- Ensure `scheduledFor` is in the future
- Verify timezone (ISO 8601 uses UTC by default)

**Check trigger wasn't disabled:**
```bash
GET /admin/triggers/{triggerId}
# One-time triggers auto-disable after execution
```

## Best Practices

### Cron Expressions
- Use specific expressions rather than `* * * * *` (every minute)
- Consider server load when scheduling frequent jobs
- Use timezone-aware expressions for business hours
- Document complex expressions in trigger name/description

### Error Handling
- Actions should handle failures gracefully
- Use retry configuration for transient errors
- Monitor action invocation status
- Set up alerts for repeated failures

### Resource Management
- Avoid overlapping executions (use longer intervals)
- Disable triggers when not in use
- Clean up completed one-time triggers
- Monitor queue backlog

### Testing
- Always test with `/test-fire` before enabling
- Use test environments for new schedules
- Verify timezone handling with edge cases
- Monitor first few executions after changes

## Examples

### Daily Report at 9 AM

```json
{
  "name": "Daily Morning Report",
  "capabilityId": "<cron-capability-id>",
  "config": {
    "mode": "cron",
    "cron": {
      "expression": "0 9 * * *",
      "timezone": "America/New_York"
    }
  },
  "isEnabled": true
}
```

### Cleanup Every Sunday

```json
{
  "name": "Weekly Cleanup",
  "capabilityId": "<cron-capability-id>",
  "config": {
    "mode": "cron",
    "cron": {
      "expression": "0 2 * * 0"
    }
  },
  "isEnabled": true
}
```

### Scheduled Deployment

```json
{
  "name": "Production Deploy - Dec 31",
  "capabilityId": "<cron-capability-id>",
  "config": {
    "mode": "one-time",
    "oneTime": {
      "scheduledFor": "2025-12-31T02:00:00Z"
    }
  },
  "isEnabled": true
}
```

## See Also

- [Plugin Runtime Overview](../plugin-runtime.md)
- [Gmail Plugin Setup](./gmail-provider.md)
- [Pipeline Configuration](../pipelines.md)
