import { PluginServiceRegistry, type PluginCoreServiceDefinitions } from "./plugin-services.js";
import { PLUGIN_SERVICE_SCOPES } from "./scopes.js";
import type {
  EmailProviderRegistry,
  EmailProviderRegistration,
} from "./email-provider-registry.js";
import type {
  UserAdminService,
  UserRoleChangeOptions,
  UserActivationChangeOptions,
  SessionRevokeOptions,
} from "./user-admin-service.js";
import type { UserRole } from "@latchflow/db";
import type {
  ActionDefinitionControlService,
  BundleAssignmentControlService,
  BundleControlService,
  PipelineControlService,
  RecipientControlService,
  TriggerDefinitionControlService,
  ActivationChangeOptions,
} from "./resource-control-service.js";
import type { PluginServiceContext } from "./context.js";
import type {
  StorageAccessService,
  ReleaseLinkRequest,
  ReleaseLinkResult,
} from "./storage-service.js";

class StubEmailProviderRegistry implements EmailProviderRegistry {
  register(_context: PluginServiceContext, _provider: EmailProviderRegistration): void {
    throw new Error("Email provider registry not implemented");
  }
  unregister(_context: PluginServiceContext, _providerId: string): void {
    throw new Error("Email provider registry not implemented");
  }
  getProvider(): EmailProviderRegistration | undefined {
    throw new Error("Email provider registry not implemented");
  }
  getActiveProvider(): EmailProviderRegistration | undefined {
    throw new Error("Email provider registry not implemented");
  }
  setActiveProvider(_context: PluginServiceContext, _providerId: string): void {
    throw new Error("Email provider registry not implemented");
  }
  listProviders(): EmailProviderRegistration[] {
    throw new Error("Email provider registry not implemented");
  }
}

class StubUserAdminService implements UserAdminService {
  async assignRole(
    _context: PluginServiceContext,
    _userId: string,
    _role: UserRole,
    _options?: UserRoleChangeOptions,
  ): Promise<void> {
    throw new Error("User admin service not implemented");
  }
  async setActive(
    _context: PluginServiceContext,
    _userId: string,
    _isActive: boolean,
    _options?: UserActivationChangeOptions,
  ): Promise<void> {
    throw new Error("User admin service not implemented");
  }
  async revokeSessions(
    _context: PluginServiceContext,
    _userId: string,
    _options?: SessionRevokeOptions,
  ): Promise<number> {
    throw new Error("User admin service not implemented");
  }
}

class StubToggleService
  implements
    BundleControlService,
    BundleAssignmentControlService,
    RecipientControlService,
    ActionDefinitionControlService,
    TriggerDefinitionControlService,
    PipelineControlService
{
  async setEnabled(
    _context: PluginServiceContext,
    _id: string,
    _isEnabled: boolean,
    _options?: ActivationChangeOptions,
  ): Promise<void> {
    throw new Error("Resource toggle service not implemented");
  }
}

class StubStorageAccessService implements StorageAccessService {
  async createReleaseLink(
    _context: PluginServiceContext,
    _request: ReleaseLinkRequest,
  ): Promise<ReleaseLinkResult> {
    throw new Error("Storage access service not implemented");
  }

  async getBundleObjectHead(
    _context: PluginServiceContext,
    _bundleId: string,
    _objectKey: string,
  ): Promise<{ etag?: string; contentType?: string; contentLength?: number } | null> {
    throw new Error("Storage access service not implemented");
  }
}

function createStubToggleService(): StubToggleService {
  return new StubToggleService();
}

export function createStubPluginServiceRegistry(): PluginServiceRegistry {
  const toggles = createStubToggleService();
  const storage = new StubStorageAccessService();
  const definitions: PluginCoreServiceDefinitions = {
    emailProviders: {
      service: new StubEmailProviderRegistry(),
      scopes: [PLUGIN_SERVICE_SCOPES.EMAIL_SEND],
      description: "Email provider registry stub",
    },
    users: {
      service: new StubUserAdminService(),
      scopes: [PLUGIN_SERVICE_SCOPES.USERS_WRITE],
      description: "User admin service stub",
    },
    bundles: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.BUNDLES_WRITE],
    },
    bundleAssignments: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.BUNDLE_ASSIGNMENTS_WRITE],
    },
    recipients: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.RECIPIENTS_WRITE],
    },
    actions: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.ACTIONS_WRITE],
    },
    triggers: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.TRIGGERS_WRITE],
    },
    pipelines: {
      service: toggles,
      scopes: [PLUGIN_SERVICE_SCOPES.PIPELINES_WRITE],
    },
    storage: {
      service: storage,
      scopes: [PLUGIN_SERVICE_SCOPES.STORAGE_LINK],
      description: "Storage access service stub",
    },
  };
  return new PluginServiceRegistry(definitions);
}
