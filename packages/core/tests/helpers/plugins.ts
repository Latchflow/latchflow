// Plugin loader utilities (scaffold)

export type LoadedPlugin = {
  id: string;
  cleanup?: () => Promise<void> | void;
};

export async function loadTestPlugin(
  _opts: { path: string } | { module: any },
): Promise<LoadedPlugin> {
  // TODO: integrate with core plugin loader registry
  return { id: "test-plugin" };
}

export async function unloadTestPlugin(_p: LoadedPlugin): Promise<void> {
  // TODO: remove plugin from registry and run cleanup if provided
}
