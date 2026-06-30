import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";

const registrations = new Map<string, PluginPanelRegistration>();

export function registerPluginPanel(
  registration: PluginPanelRegistration
): () => void {
  registrations.set(registration.id, registration);
  return () => {
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
    }
  };
}

export function getPluginPanelRegistrations(): ReadonlyMap<
  string,
  PluginPanelRegistration
> {
  return registrations;
}

export function clearPluginPanelsForTests(): void {
  registrations.clear();
}
