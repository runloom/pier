export interface RendererPluginRuntimeDiagnostic {
  message: string;
  pluginId: string;
}

type Listener = () => void;

const diagnosticsByPluginId = new Map<
  string,
  RendererPluginRuntimeDiagnostic
>();
const listeners = new Set<Listener>();
let snapshot: readonly RendererPluginRuntimeDiagnostic[] = [];

function publish(): void {
  snapshot = [...diagnosticsByPluginId.values()];
  for (const listener of listeners) {
    listener();
  }
}

export function clearRendererPluginRuntimeDiagnostic(pluginId: string): void {
  if (diagnosticsByPluginId.delete(pluginId)) {
    publish();
  }
}

export function getRendererPluginRuntimeDiagnostics(): readonly RendererPluginRuntimeDiagnostic[] {
  return snapshot;
}

export function reportRendererPluginRuntimeDiagnostic(
  diagnostic: RendererPluginRuntimeDiagnostic
): void {
  diagnosticsByPluginId.set(diagnostic.pluginId, diagnostic);
  publish();
}

export function subscribeRendererPluginRuntimeDiagnostics(
  listener: Listener
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearRendererPluginRuntimeDiagnosticsForTests(): void {
  diagnosticsByPluginId.clear();
  publish();
}
