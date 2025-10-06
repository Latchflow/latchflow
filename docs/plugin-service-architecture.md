# Plugin Service Architecture

## Goals

- Provide plugin runtimes with guarded access to core capabilities (email, user admin, bundle/pipeline toggles) without exposing raw database or secret storage.
- Ensure every privileged call can be audited with plugin + capability metadata.
- Allow future enforcement of per-capability service scopes and rate limits without rewriting plugin contracts.

## Key Types

- `PluginServiceScope` (`packages/core/src/services/scopes.ts`) enumerates the discrete operations a plugin may request (e.g., `email:send`, `users:write`).
- `PluginServiceContext` (`packages/core/src/services/context.ts`) captures plugin identity, capability ids, invocation metadata, and execution kind. Service methods receive this to support auditing and policy checks.
- `PluginServiceError` (`packages/core/src/services/errors.ts`) standardizes error kinds (validation, permission, retryable, rate limit, etc.) and retry hints.

## Service Registry

- `PluginServiceRegistry` (`packages/core/src/services/plugin-services.ts`) now keeps `PluginCoreServiceEntry` objects containing the concrete service implementation plus required scopes and optional description (including the new storage access façade).
- Runtime factories obtain a scoped view via `registry.getAllServices()` while future enforcement can call `getRequiredScopes()` to validate capability permissions before yielding a service.
- Stub implementations in `packages/core/src/services/stubs.ts` reflect the same contract and declare scope requirements for each service key.

## Service Interfaces

- Email provider registration (`email-provider-registry.ts`) requires a `PluginServiceContext` for register/unregister/activation calls, ensuring we know which plugin registered a provider.
- User admin (`user-admin-service.ts`) and resource toggles (`resource-control-service.ts`) require context as the first parameter so mutation flows can attribute the operation.
- Storage access (`storage-service.ts`) offers release link creation and bundle object metadata lookups, again requiring context for auditing.
- Each service method accepts specific option objects (actorId, reason, audit metadata) to capture extra audit information from the runtime.

## Provider Descriptors & SystemConfig-backed Secrets

- Plugins can now declare `providers` on their module export. Each descriptor supplies:
  - A `kind` (e.g. `email`), stable `id`, human-readable `displayName`, and a JSON schema describing the configuration the provider expects.
  - Optional defaults—used to seed SystemConfig on first load and to provide development-friendly fallbacks.
  - A `register` hook that receives the validated config, a scoped logger, and the standard runtime services. The hook is responsible for wiring the provider into the appropriate core registry (e.g. `emailProviders.register`) and may set itself active when appropriate.
- Core stores provider configuration in `SystemConfig` under the namespaced key `PLUGIN_{PLUGIN_NAME}_PROVIDER_{PROVIDER_ID}`. Values are AES-GCM encrypted and can contain arbitrary JSON (obj/array). Environment defaults are only used to seed the initial record; subsequent edits flow through the admin API.
- On startup (and hot reload), the loader:
  1. Validates or seeds the SystemConfig entry based on the descriptor’s schema and defaults.
  2. Injects the decrypted config object into the provider register hook.
  3. Skips registration (with a warning) if validation fails, preventing half-configured providers from crashing the service.
- The Gmail plugin is the first adopter: it declares the required OAuth credentials and sender address, registers itself with the email provider registry, and becomes the active provider when `makeDefault` is true.

## Execution Flow (Implemented)

1. Plugin runtime resolves capability metadata (including allowed service scopes).
2. Service adapters record the `PluginServiceContext`, append audit entries, and invoke the underlying core system.
3. Action runner enforces concurrency limits (default 10, configurable via `PLUGIN_ACTION_CONCURRENCY`).
4. Trigger runtime manager handles lifecycle (start/stop/reload) with graceful shutdown.
5. Errors bubble up as `PluginServiceError` instances, allowing the runtime to mark invocations retryable vs fatal.

## Implementation Status

✅ **Completed:**
- Plugin runtime registration with lifecycle validation
- Trigger and action execution pipelines
- Service adapter instrumentation with audit logging
- Email provider registry with Gmail integration
- Config encryption/decryption (AES-GCM)
- Provider configuration via SystemConfig
- SMTP fallback for email delivery
- Hot-reloading for development
- Concurrency control and backlog processing
- Graceful shutdown and configuration change handling

📋 **Future Enhancements:**
- Per-capability scope enforcement during registration
- Rate limiting for service calls
- Plugin version management and isolation
- Advanced monitoring and alerting

## Verification

- Plugin runtime registration wraps trigger/action factories, asserting required lifecycle methods at execution time. See `packages/core/src/plugins/plugin-loader.ts` and the associated unit coverage in `src/runtime/*` tests.
- Built-in `email.send` coverage includes an integration path from `POST /actions/:id/test-run` through the action queue to the email service.
- Admin magic link and invite flows now exercise the email provider registry via `EmailDeliveryService`, with integration tests verifying provider dispatch when an active provider is configured.
- Security regression tests cover config encryption/decryption and enforce context validation for plugin-facing services.
- Gmail provider integration tests register the plugin through the runtime services and mock the Gmail API to verify token exchange, request formatting, and provider cleanup.
