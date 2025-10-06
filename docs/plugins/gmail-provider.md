# Gmail Email Provider

The Gmail provider plugin (`@latchflow/plugin-gmail`) enables email delivery through the Gmail API using OAuth2 authentication.

## Features

- OAuth2-based Gmail API integration
- Automatic token refresh
- HTML and plain text email support
- CC/BCC recipient support
- Custom headers
- Automatic fallback to SMTP if provider fails

## Prerequisites

### Google Cloud Project Setup

1. **Create a Google Cloud Project:**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing

2. **Enable Gmail API:**
   ```bash
   # Navigate to APIs & Services > Library
   # Search for "Gmail API"
   # Click Enable
   ```

3. **Create OAuth 2.0 Credentials:**
   ```bash
   # Navigate to APIs & Services > Credentials
   # Click "Create Credentials" > "OAuth 2.0 Client ID"
   # Application type: Web application
   # Add authorized redirect URI: http://localhost:3000/oauth/callback
   ```

4. **Download credentials:**
   - Save `client_id` and `client_secret`

### Obtain Refresh Token

Use Google's OAuth2 Playground or create a simple auth flow:

```bash
# OAuth2 Playground method:
# 1. Go to https://developers.google.com/oauthplayground/
# 2. Click settings (gear icon)
# 3. Check "Use your own OAuth credentials"
# 4. Enter your Client ID and Client Secret
# 5. Select Gmail API v1 scope: https://www.googleapis.com/auth/gmail.send
# 6. Click "Authorize APIs"
# 7. Complete OAuth flow
# 8. Click "Exchange authorization code for tokens"
# 9. Copy the "refresh_token"
```

## Configuration

### Environment Variables

```bash
# Gmail OAuth Credentials
GMAIL_CLIENT_ID=your-client-id.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=your-client-secret
GMAIL_REFRESH_TOKEN=your-refresh-token

# Sender Email (must be authorized in Gmail)
GMAIL_SENDER=your-email@gmail.com

# Optional: Provider Settings
GMAIL_PROVIDER_ID=gmail                    # Default: "gmail"
GMAIL_DISPLAY_NAME=Gmail                   # Default: "Gmail"
GMAIL_MAKE_DEFAULT=true                    # Default: true
```

### SystemConfig Storage

Provider configuration is stored in the `SystemConfig` table under:
```
PLUGIN_LATCHFLOW_PLUGIN_GMAIL_PROVIDER_GMAIL
```

The configuration is AES-GCM encrypted and contains:

```json
{
  "providerId": "gmail",
  "displayName": "Gmail",
  "clientId": "...",
  "clientSecret": "...",
  "refreshToken": "...",
  "sender": "your-email@gmail.com",
  "makeDefault": true
}
```

### Configuration Schema

```json
{
  "type": "object",
  "properties": {
    "providerId": {
      "type": "string",
      "description": "Unique identifier for this provider instance"
    },
    "displayName": {
      "type": "string",
      "description": "Human-readable name"
    },
    "clientId": {
      "type": "string",
      "description": "Google OAuth2 client ID"
    },
    "clientSecret": {
      "type": "string",
      "description": "Google OAuth2 client secret"
    },
    "refreshToken": {
      "type": "string",
      "description": "OAuth2 refresh token"
    },
    "sender": {
      "type": "string",
      "pattern": "^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$",
      "description": "Default sender email address"
    },
    "makeDefault": {
      "type": "boolean",
      "description": "Set as active email provider on registration"
    }
  },
  "required": ["providerId", "clientId", "clientSecret", "refreshToken", "sender"]
}
```

## Setup

### 1. Set Environment Variables

Create or update `.env`:

```bash
# .env
GMAIL_CLIENT_ID=123456789.apps.googleusercontent.com
GMAIL_CLIENT_SECRET=GOCSPX-abc123...
GMAIL_REFRESH_TOKEN=1//0abc123...
GMAIL_SENDER=noreply@yourdomain.com
```

### 2. Restart Application

```bash
# The plugin auto-registers on startup
pnpm -F core dev
```

### 3. Verify Registration

```bash
# Check plugin status
GET /admin/plugins

# Look for @latchflow/plugin-gmail with providers array
{
  "plugins": [
    {
      "name": "@latchflow/plugin-gmail",
      "providers": [
        {
          "kind": "email",
          "id": "gmail",
          "displayName": "Gmail"
        }
      ]
    }
  ]
}
```

### 4. Test Email Delivery

```bash
# Create email action
POST /admin/actions
{
  "name": "Test Gmail",
  "capabilityId": "<email-send-capability-id>",
  "config": {
    "to": ["test@example.com"],
    "subject": "Test Email",
    "textBody": "This is a test email sent via Gmail provider."
  },
  "isEnabled": true
}

# Test fire the action
POST /admin/actions/{actionId}/test-run
{}
```

## Usage

### Email Action Configuration

The Gmail provider integrates with the built-in `email.send` action:

```json
{
  "to": ["recipient@example.com"],
  "cc": ["cc@example.com"],
  "bcc": ["bcc@example.com"],
  "subject": "Email Subject",
  "textBody": "Plain text content",
  "htmlBody": "<p>HTML content</p>",
  "from": {
    "address": "custom@yourdomain.com",
    "displayName": "Custom Name"
  },
  "replyTo": {
    "address": "reply@yourdomain.com"
  },
  "headers": {
    "X-Custom-Header": "value"
  }
}
```

### Dynamic Context Override

Trigger context can override action config:

```json
{
  "config": {
    "to": ["default@example.com"],
    "subject": "Default Subject",
    "textBody": "Default body"
  },
  "payload": {
    "to": ["override@example.com"],
    "subject": "Dynamic Subject"
  }
}
```

Result: Email sent to `override@example.com` with subject "Dynamic Subject" and default body.

## Email Format

### Recipients

**Simple format:**
```json
{
  "to": ["user@example.com"]
}
```

**With display names:**
```json
{
  "to": [
    {
      "address": "user@example.com",
      "displayName": "John Doe"
    }
  ]
}
```

**Mixed format:**
```json
{
  "to": [
    "simple@example.com",
    {
      "address": "named@example.com",
      "displayName": "Jane Smith"
    }
  ]
}
```

### Content Types

**Plain text only:**
```json
{
  "textBody": "This is plain text content."
}
```

**HTML only:**
```json
{
  "htmlBody": "<h1>Hello</h1><p>HTML content</p>"
}
```

**Multipart (recommended):**
```json
{
  "textBody": "Plain text fallback",
  "htmlBody": "<h1>Hello</h1><p>HTML content</p>"
}
```

### Custom Headers

```json
{
  "headers": {
    "X-Priority": "1",
    "X-Mailer": "Latchflow",
    "Reply-To": "support@example.com"
  }
}
```

## Provider Behavior

### Token Refresh

The provider automatically refreshes access tokens:

1. Uses stored `refreshToken` to obtain new access token
2. Caches access token for the session
3. Refreshes when token expires
4. Logs errors if refresh fails

### Error Handling

**OAuth errors:**
```
Error: Gmail provider failed to obtain access token
```
- Check `clientId` and `clientSecret` are correct
- Verify `refreshToken` is still valid
- Ensure Gmail API is enabled in Google Cloud

**API errors:**
```
Error: Gmail API error (403): Forbidden
```
- Verify sender email is authorized in Gmail
- Check OAuth scopes include `gmail.send`
- Ensure daily sending limits not exceeded

### Fallback to SMTP

If Gmail provider fails, email delivery automatically falls back to SMTP (if configured):

```
Plugin email provider failed; attempting SMTP fallback
```

Configure SMTP fallback:
```bash
SMTP_URL=smtp://user:pass@smtp.example.com:587
SMTP_FROM=noreply@example.com
```

## Limitations

### Current Limitations

- **No attachments support** - Attachments not yet implemented
- **Single provider instance** - Only one Gmail provider at a time
- **No batch sending** - Each email sent individually

### Gmail API Limits

- **Daily sending limit:** 2,000 emails/day (varies by account type)
- **Rate limit:** 100 emails/second
- **Message size:** 25 MB maximum

See [Gmail API Usage Limits](https://developers.google.com/gmail/api/reference/quota) for details.

## Monitoring

### Provider Status

```bash
# Check active email provider
GET /admin/system/email-provider

Response:
{
  "activeProvider": {
    "id": "gmail",
    "displayName": "Gmail",
    "kind": "email"
  }
}
```

### Delivery Logs

Email deliveries are logged with provider info:

```json
{
  "level": "info",
  "component": "email-delivery",
  "providerId": "gmail",
  "pluginName": "@latchflow/plugin-gmail",
  "msg": "Email delivered via plugin provider"
}
```

### Service Audit

Provider calls are audited:

```json
{
  "timestamp": "2025-10-06T12:00:00Z",
  "pluginName": "@latchflow/plugin-gmail",
  "serviceKey": "emailProviders",
  "method": "register",
  "requestedScopes": ["email:send"],
  "grantedScopes": ["email:send"],
  "outcome": "SUCCEEDED"
}
```

## Troubleshooting

### Provider Not Registering

**Check environment variables:**
```bash
# Verify all required vars are set
echo $GMAIL_CLIENT_ID
echo $GMAIL_CLIENT_SECRET
echo $GMAIL_REFRESH_TOKEN
echo $GMAIL_SENDER
```

**Check startup logs:**
```
Gmail provider configuration incomplete; skipping registration
```

Missing fields will be logged with the provider configuration.

### Invalid Credentials Error

```
Error: invalid_client
```

**Solutions:**
- Verify `clientId` matches Google Cloud Console
- Ensure `clientSecret` is correct
- Check credentials are for correct Google Cloud project

### Refresh Token Expired

```
Error: invalid_grant
```

**Solutions:**
- Generate new refresh token using OAuth2 Playground
- Ensure refresh token hasn't been revoked
- Check app hasn't been removed from authorized apps

### Sender Not Authorized

```
Error: Gmail API error (403): Insufficient Permission
```

**Solutions:**
- Verify sender email matches authenticated Google account
- Ensure Gmail account allows API access
- Check OAuth scopes include `https://www.googleapis.com/auth/gmail.send`

### Rate Limit Exceeded

```
Error: Gmail API error (429): Too Many Requests
```

**Solutions:**
- Reduce sending frequency
- Implement backoff/retry logic in actions
- Consider upgrading to Google Workspace for higher limits
- Use multiple provider instances (when supported)

## Security Best Practices

### Credential Management

✅ **Do:**
- Store credentials in environment variables or secret manager
- Rotate refresh tokens periodically
- Use separate Google accounts for different environments
- Monitor OAuth app usage in Google Admin Console

❌ **Don't:**
- Commit credentials to version control
- Share refresh tokens between environments
- Use personal Gmail for production
- Log decrypted credentials

### Scope Limitation

Only request necessary scopes:
- `https://www.googleapis.com/auth/gmail.send` - Send email only
- Avoid broader scopes like `gmail.readonly` unless needed

### Access Control

- Limit who can modify SystemConfig
- Audit provider registration changes
- Monitor unusual sending patterns
- Set up alerts for delivery failures

## Advanced Configuration

### Multiple Providers (Future)

Future support for multiple Gmail providers:

```bash
# Production provider
GMAIL_PROVIDER_ID=gmail-prod
GMAIL_CLIENT_ID=prod-client-id
GMAIL_SENDER=prod@example.com

# Testing provider
GMAIL_PROVIDER_ID=gmail-test
GMAIL_CLIENT_ID=test-client-id
GMAIL_SENDER=test@example.com
```

### Custom Provider ID

Use custom provider IDs for multi-tenant setups:

```bash
GMAIL_PROVIDER_ID=gmail-tenant-1
GMAIL_SENDER=tenant1@example.com
```

### Environment-Specific Config

```bash
# .env.production
GMAIL_CLIENT_ID=prod-id
GMAIL_SENDER=noreply@company.com

# .env.development
GMAIL_CLIENT_ID=dev-id
GMAIL_SENDER=dev@company.com
```

## Migration from SMTP

### 1. Configure Gmail Provider

Set up Gmail provider as documented above.

### 2. Test Email Delivery

Create test action using Gmail provider.

### 3. Update Existing Actions

No changes needed - actions automatically use active provider.

### 4. Monitor Delivery

Watch logs to confirm Gmail provider is being used:
```
Email delivered via plugin provider (providerId: gmail)
```

### 5. Remove SMTP Config (Optional)

SMTP remains as fallback. To remove:
```bash
# Remove from .env
# SMTP_URL=...
# SMTP_FROM=...
```

## See Also

- [Plugin Runtime Overview](../plugin-runtime.md)
- [Email Action Reference](../actions/email-send.md)
- [System Configuration](../system-configuration.md)
- [Gmail API Documentation](https://developers.google.com/gmail/api)
