import type {
  EmailProviderRegistry,
  // EmailSendRequest,
  // EmailSendResult,
  // EmailProviderRegistration,
} from "./email-provider-registry.js";
import type { UserAdminService } from "./user-admin-service.js";
import type {
  ActionDefinitionControlService,
  BundleAssignmentControlService,
  BundleControlService,
  PipelineControlService,
  RecipientControlService,
  TriggerDefinitionControlService,
} from "./resource-control-service.js";
import type { ActivationChangeOptions } from "./resource-control-service.js";
import type { PluginServiceScope } from "./scopes.js";
import type { PluginServiceContext, PluginServiceCallContext } from "./context.js";
import { recordPluginServiceCall } from "../audit/plugin-service-call.js";
import { PluginServiceError } from "./errors.js";
import type { StorageAccessService } from "./storage-service.js";

export type { PluginServiceScope, PluginServiceContext, PluginServiceCallContext };
export { PLUGIN_SERVICE_SCOPES } from "./scopes.js";

export interface PluginCoreServiceEntry<TService> {
  service: TService;
  scopes: PluginServiceScope[];
  description?: string;
}

export interface PluginCoreServiceDefinitions {
  emailProviders: PluginCoreServiceEntry<EmailProviderRegistry>;
  users: PluginCoreServiceEntry<UserAdminService>;
  bundles: PluginCoreServiceEntry<BundleControlService>;
  bundleAssignments: PluginCoreServiceEntry<BundleAssignmentControlService>;
  recipients: PluginCoreServiceEntry<RecipientControlService>;
  actions: PluginCoreServiceEntry<ActionDefinitionControlService>;
  triggers: PluginCoreServiceEntry<TriggerDefinitionControlService>;
  pipelines: PluginCoreServiceEntry<PipelineControlService>;
  storage: PluginCoreServiceEntry<StorageAccessService>;
}

export type PluginCoreServices = {
  [K in keyof PluginCoreServiceDefinitions]: PluginCoreServiceDefinitions[K]["service"];
};

export type {
  EmailProviderRegistry,
  EmailProviderRegistration,
  EmailSendRequest,
  EmailSendResult,
} from "./email-provider-registry.js";
export type {
  StorageAccessService,
  ReleaseLinkRequest,
  ReleaseLinkResult,
} from "./storage-service.js";

export type { ActivationChangeOptions };

export type PluginCoreServiceKeys = keyof PluginCoreServices;

export type PluginServiceRuntimeContextInit = Omit<PluginServiceContext, "timestamp"> &
  Partial<PluginServiceCallContext>;

export class PluginServiceRegistry {
  private readonly allServices: PluginCoreServices;

  constructor(private readonly definitions: PluginCoreServiceDefinitions) {
    this.allServices = Object.fromEntries(
      Object.entries(definitions).map(([key, entry]) => [key, entry.service]),
    ) as PluginCoreServices;
  }

  getDefinition<T extends PluginCoreServiceKeys>(
    key: T,
  ): PluginCoreServiceEntry<PluginCoreServices[T]> {
    return this.definitions[key] as PluginCoreServiceEntry<PluginCoreServices[T]>;
  }

  get<T extends PluginCoreServiceKeys>(key: T): PluginCoreServices[T] {
    return this.definitions[key].service as PluginCoreServices[T];
  }

  getRequiredScopes(key: PluginCoreServiceKeys): PluginServiceScope[] {
    return this.definitions[key].scopes;
  }

  getAllServices(): PluginCoreServices {
    return this.allServices;
  }

  createScopedServices(baseContext: PluginServiceRuntimeContextInit): PluginCoreServices {
    validateBaseContext(baseContext);
    return createInstrumentedServices(this.definitions, baseContext);
  }
}

type InstrumentationOptions<TService extends object> = {
  serviceKey: PluginCoreServiceKeys;
  entry: PluginCoreServiceEntry<TService>;
  baseContext: PluginServiceRuntimeContextInit;
};

function createInstrumentedServices(
  definitions: PluginCoreServiceDefinitions,
  baseContext: PluginServiceRuntimeContextInit,
): PluginCoreServices {
  const entries = Object.entries(definitions).map(([key, entry]) => [
    key,
    createServiceProxy(entry.service, {
      serviceKey: key as PluginCoreServiceKeys,
      entry,
      baseContext,
    }),
  ]);
  return Object.fromEntries(entries) as PluginCoreServices;
}

function createServiceProxy<TService extends object>(
  service: TService,
  options: InstrumentationOptions<TService>,
): TService {
  if (service === null || typeof service !== "object") {
    return service;
  }

  const { serviceKey, entry, baseContext } = options;
  const handler: ProxyHandler<TService> = {
    get(target, prop, receiver) {
      const value = Reflect.get(target as object, prop, receiver);
      if (typeof value !== "function") {
        return value;
      }
      const methodName = String(prop);
      return function instrumented(this: unknown, ...args: unknown[]) {
        if (args.length === 0) {
          throw PluginServiceError.fatal(
            "PLUGIN_SERVICE_CONTEXT_MISSING",
            `Core service ${String(serviceKey)}.${methodName} requires a context argument`,
          );
        }

        const [providedContext, ...rest] = args;
        if (!providedContext || typeof providedContext !== "object") {
          throw PluginServiceError.fatal(
            "PLUGIN_SERVICE_CONTEXT_INVALID",
            `Core service ${String(serviceKey)}.${methodName} requires a context object`,
          );
        }

        const timestamp = new Date();
        const callContext = mergeCallContext(
          providedContext as PluginServiceCallContext,
          baseContext,
          entry.scopes,
          timestamp,
        );

        const finalArgs = [callContext, ...rest];
        const boundTarget = this === receiver ? target : this;

        try {
          const result = Reflect.apply(value, boundTarget as object, finalArgs);
          if (isPromiseLike(result)) {
            return (result as Promise<unknown>)
              .then((resolved) => {
                logServiceCallSuccess(callContext, serviceKey, methodName, entry.scopes);
                return resolved;
              })
              .catch((err) => {
                logServiceCallFailure(callContext, serviceKey, methodName, entry.scopes, err);
                throw err;
              });
          }
          logServiceCallSuccess(callContext, serviceKey, methodName, entry.scopes);
          return result;
        } catch (err) {
          logServiceCallFailure(callContext, serviceKey, methodName, entry.scopes, err);
          throw err;
        }
      };
    },
  };

  return new Proxy(service, handler);
}

function mergeCallContext(
  provided: PluginServiceCallContext,
  base: PluginServiceRuntimeContextInit,
  grantedScopes: string[],
  timestamp: Date,
): PluginServiceCallContext {
  const defaultRequested = Array.isArray(provided.requestedScopes)
    ? provided.requestedScopes
    : grantedScopes;
  const requestedScopes = Array.from(new Set(defaultRequested));
  const deniedScopes = requestedScopes.filter((scope) => !grantedScopes.includes(scope));

  const context: PluginServiceCallContext = {
    ...provided,
    ...base,
    pluginName: base.pluginName,
    pluginId: base.pluginId ?? provided.pluginId,
    capabilityId: base.capabilityId,
    capabilityKey: base.capabilityKey,
    executionKind: base.executionKind,
    definitionId: base.definitionId ?? provided.definitionId,
    invocationId: base.invocationId ?? provided.invocationId,
    triggerEventId: base.triggerEventId ?? provided.triggerEventId,
    manualInvokerId: base.manualInvokerId ?? provided.manualInvokerId,
    correlationId: provided.correlationId ?? base.correlationId,
    requestedScopes,
    grantedScopes,
    deniedScopes: deniedScopes.length > 0 ? deniedScopes : undefined,
    timestamp,
  };

  return context;
}

function logServiceCallSuccess(
  context: PluginServiceCallContext,
  serviceKey: PluginCoreServiceKeys,
  method: string,
  grantedScopes: string[],
) {
  recordPluginServiceCall({
    timestamp: context.timestamp,
    pluginName: context.pluginName,
    pluginId: context.pluginId,
    capabilityId: context.capabilityId,
    capabilityKey: context.capabilityKey,
    executionKind: context.executionKind,
    definitionId: context.definitionId,
    invocationId: context.invocationId,
    triggerEventId: context.triggerEventId,
    manualInvokerId: context.manualInvokerId,
    correlationId: context.correlationId,
    serviceKey: String(serviceKey),
    method,
    requestedScopes: context.requestedScopes ?? grantedScopes,
    grantedScopes,
    deniedScopes: context.deniedScopes,
    outcome: "SUCCEEDED",
  }).catch(() => {
    // Swallow logging errors to avoid impacting plugin execution
  });
}

function logServiceCallFailure(
  context: PluginServiceCallContext,
  serviceKey: PluginCoreServiceKeys,
  method: string,
  grantedScopes: string[],
  error: unknown,
) {
  const err = error as Error;
  const errorKind = err instanceof PluginServiceError ? err.kind : undefined;
  recordPluginServiceCall({
    timestamp: context.timestamp,
    pluginName: context.pluginName,
    pluginId: context.pluginId,
    capabilityId: context.capabilityId,
    capabilityKey: context.capabilityKey,
    executionKind: context.executionKind,
    definitionId: context.definitionId,
    invocationId: context.invocationId,
    triggerEventId: context.triggerEventId,
    manualInvokerId: context.manualInvokerId,
    correlationId: context.correlationId,
    serviceKey: String(serviceKey),
    method,
    requestedScopes: context.requestedScopes ?? grantedScopes,
    grantedScopes,
    deniedScopes: context.deniedScopes,
    outcome: "FAILED",
    errorMessage: err.message,
    errorKind,
  }).catch(() => {
    // Swallow logging errors to avoid impacting plugin execution
  });
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    !!value &&
    (typeof value === "object" || typeof value === "function") &&
    typeof (value as { then?: unknown }).then === "function"
  );
}

function validateBaseContext(base: PluginServiceRuntimeContextInit) {
  if (!base.pluginName) {
    throw new Error("Plugin service runtime context requires pluginName");
  }
  if (!base.capabilityId) {
    throw new Error("Plugin service runtime context requires capabilityId");
  }
  if (!base.capabilityKey) {
    throw new Error("Plugin service runtime context requires capabilityKey");
  }
  if (!base.executionKind) {
    throw new Error("Plugin service runtime context requires executionKind");
  }
}
