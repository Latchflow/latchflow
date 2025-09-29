export interface ActivationChangeOptions {
  actorId?: string;
  reason?: string;
  auditMetadata?: Record<string, unknown>;
  timestamp?: Date;
}

export interface BundleControlService {
  setEnabled(
    bundleId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface BundleAssignmentControlService {
  setEnabled(
    assignmentId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface RecipientControlService {
  setEnabled(
    recipientId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface ActionDefinitionControlService {
  setEnabled(
    actionDefinitionId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface TriggerDefinitionControlService {
  setEnabled(
    triggerDefinitionId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}

export interface PipelineControlService {
  setEnabled(
    pipelineId: string,
    isEnabled: boolean,
    options?: ActivationChangeOptions,
  ): Promise<void>;
}
