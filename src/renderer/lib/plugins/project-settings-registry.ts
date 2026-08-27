import type { ReactNode } from "react";

export interface PluginProjectSettingsRegistration {
  id: string;
  render: (props: {
    isPierHome: boolean;
    projectRootPath: string;
  }) => ReactNode;
  title: () => string;
  visible?: (props: { isPierHome: boolean }) => boolean;
}

const registrations = new Map<string, PluginProjectSettingsRegistration>();
const listeners = new Set<() => void>();
let revision = 0;

function notify(): void {
  revision += 1;
  for (const listener of listeners) {
    listener();
  }
}

export function registerPluginProjectSettings(
  registration: PluginProjectSettingsRegistration
): () => void {
  if (registrations.has(registration.id)) {
    throw new Error(
      `project settings id is already registered: ${registration.id}`
    );
  }
  registrations.set(registration.id, registration);
  notify();
  return () => {
    if (registrations.get(registration.id) === registration) {
      registrations.delete(registration.id);
      notify();
    }
  };
}

export function getPluginProjectSettingsRegistrations(): readonly PluginProjectSettingsRegistration[] {
  return [...registrations.values()];
}

export function getPluginProjectSettingsRevision(): number {
  return revision;
}

export function subscribePluginProjectSettingsRegistry(
  listener: () => void
): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function clearPluginProjectSettingsForTests(): void {
  registrations.clear();
  notify();
}
