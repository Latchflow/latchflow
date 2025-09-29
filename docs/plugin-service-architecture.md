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

## Execution Flow (Planned)

1. Plugin runtime resolves capability metadata (including allowed service scopes).
2. Registry verifies the capability has the scopes required by the requested service key.
3. Service adapter records the `PluginServiceContext`, appends audit entries, performs policy checks, and invokes the underlying core system (Prisma, queue, etc.).
4. Errors bubble up as `PluginServiceError` instances, allowing the runtime to mark invocations retryable vs fatal.

## Next Steps

- Implement real adapters that bridge registry calls to existing admin flows (Prisma + policy + change log + queue).
- Backfill capability metadata with allowed scopes and enforce during definition creation.
- Instrument service adapters with audit logging per the STORY_PLAN task.
- Replace SMTP paths in auth routes to resolve email via the registry once Gmail plugin ships.
