import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PanelDescriptor } from "@/stores/panel-descriptor.store.ts";

export function resolveRegistrationTitle(
  registration: PluginPanelRegistration | undefined,
  fallback: string
): string {
  const title = registration?.title;
  if (typeof title === "function") {
    return title();
  }
  return title ?? fallback;
}

export function pluginPanelDescriptor(
  panelId: string,
  registration: PluginPanelRegistration | undefined,
  context: PanelContext | undefined,
  title = resolveRegistrationTitle(registration, panelId)
): PanelDescriptor {
  return {
    ...(context ? { context } : {}),
    display: { short: title },
  };
}
