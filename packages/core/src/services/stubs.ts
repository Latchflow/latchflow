import { PluginServiceRegistry, type PluginCoreServices } from "./plugin-services.js";
import type {
  EmailProviderRegistry,
  EmailProviderRegistration,
} from "./email-provider-registry.js";
import type { UserAdminService } from "./user-admin-service.js";
import type {
  // ActivationChangeOptions,
  ActionDefinitionControlService,
  BundleAssignmentControlService,
  BundleControlService,
  PipelineControlService,
  RecipientControlService,
  TriggerDefinitionControlService,
} from "./resource-control-service.js";

class StubEmailProviderRegistry implements EmailProviderRegistry {
  register(): void {
    throw new Error("Email provider registry not implemented");
  }
  unregister(): void {
    throw new Error("Email provider registry not implemented");
  }
  getProvider(): EmailProviderRegistration | undefined {
    throw new Error("Email provider registry not implemented");
  }
  getActiveProvider(): EmailProviderRegistration | undefined {
    throw new Error("Email provider registry not implemented");
  }
  setActiveProvider(): void {
    throw new Error("Email provider registry not implemented");
  }
  listProviders(): EmailProviderRegistration[] {
    throw new Error("Email provider registry not implemented");
  }
}

class StubUserAdminService implements UserAdminService {
  async assignRole(): Promise<void> {
    throw new Error("User admin service not implemented");
  }
  async setActive(): Promise<void> {
    throw new Error("User admin service not implemented");
  }
  async revokeSessions(): Promise<number> {
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
  async setEnabled(): Promise<void> {
    throw new Error("Resource toggle service not implemented");
  }
}

function createStubToggleService(): StubToggleService {
  return new StubToggleService();
}

export function createStubPluginServiceRegistry(): PluginServiceRegistry {
  const toggles = createStubToggleService();
  const services: PluginCoreServices = {
    emailProviders: new StubEmailProviderRegistry(),
    users: new StubUserAdminService(),
    bundles: toggles,
    bundleAssignments: toggles,
    recipients: toggles,
    actions: toggles,
    triggers: toggles,
    pipelines: toggles,
  };
  return new PluginServiceRegistry(services);
}
