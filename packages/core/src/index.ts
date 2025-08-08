export type PluginCapability = {
  kind: "TRIGGER" | "ACTION";
  key: string;
  execute?: (...args: unknown[]) => unknown;
  startListening?: (...args: unknown[]) => unknown;
};

export class PluginRegistry {
  private capabilities = new Map<string, PluginCapability>();

  register(capability: PluginCapability): void {
    this.capabilities.set(capability.key, capability);
  }

  get(key: string): PluginCapability | undefined {
    return this.capabilities.get(key);
  }
}

export class TriggerRunner {
  async enqueueTriggerEvent(): Promise<void> {
    // TODO: implement trigger event queueing
  }
}

const registry = new PluginRegistry();

export default registry;
