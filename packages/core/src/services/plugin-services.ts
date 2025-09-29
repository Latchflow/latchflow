import type {
  EmailProviderRegistry,
  EmailSendRequest,
  EmailSendResult,
  EmailProviderRegistration,
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

export interface PluginCoreServices {
  emailProviders: EmailProviderRegistry;
  users: UserAdminService;
  bundles: BundleControlService;
  bundleAssignments: BundleAssignmentControlService;
  recipients: RecipientControlService;
  actions: ActionDefinitionControlService;
  triggers: TriggerDefinitionControlService;
  pipelines: PipelineControlService;
}

export type { EmailProviderRegistry, EmailProviderRegistration, EmailSendRequest, EmailSendResult };

export type { ActivationChangeOptions };

export type PluginCoreServiceKeys = keyof PluginCoreServices;

export class PluginServiceRegistry {
  constructor(private readonly services: PluginCoreServices) {}

  get<T extends PluginCoreServiceKeys>(key: T): PluginCoreServices[T] {
    return this.services[key];
  }

  getAll(): PluginCoreServices {
    return this.services;
  }
}
