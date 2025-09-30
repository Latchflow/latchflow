import type { PluginServiceContext } from "./context.js";

export interface ActivationChangeOptions {
  actorId?: string;
  reason?: string;
  auditMetadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface BundleControlService {
  setEnabled(
    context: PluginServiceContext,
    bundleId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface BundleAssignmentControlService {
  setEnabled(
    context: PluginServiceContext,
    assignmentId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface RecipientControlService {
  setEnabled(
    context: PluginServiceContext,
    recipientId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface ActionDefinitionControlService {
  setEnabled(
    context: PluginServiceContext,
    actionDefinitionId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface TriggerDefinitionControlService {
  setEnabled(
    context: PluginServiceContext,
    triggerDefinitionId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface PipelineControlService {
  setEnabled(
    context: PluginServiceContext,
    pipelineId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}
