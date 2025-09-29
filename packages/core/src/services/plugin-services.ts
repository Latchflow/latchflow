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
}
