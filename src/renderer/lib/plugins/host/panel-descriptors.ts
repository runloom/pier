import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import {
  normalizePanelTabChromeInput,
  type PanelContext,
  type PanelTabChrome,
  panelContextSchema,
} from "@shared/contracts/panel.ts";
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
  title = resolveRegistrationTitle(registration, panelId),
  params: Readonly<Record<string, unknown>> = {}
): PanelDescriptor {
  const tab = resolvePluginPanelTab(registration, params, title);
  // resolveTab 可从 params 派生实例标题（如变更 panel 的工作树名）；优先于 open 时传入的静态 title。
  const shortTitle = tab?.title ?? title;
  return {
    ...(context ? { context } : {}),
    display: {
      short: shortTitle,
      ...(tab?.tooltip?.title ? { long: tab.tooltip.title } : {}),
    },
    ...(registration?.kind ? { kind: registration.kind } : {}),
    ...(tab ? { tab } : {}),
  };
}

export function panelContextFromPluginParams(
  params: Readonly<Record<string, unknown>> | undefined
): PanelContext | undefined {
  const parsed = panelContextSchema.safeParse(params?.context);
  return parsed.success ? parsed.data : undefined;
}

export function resolvePluginPanelTab(
  registration: PluginPanelRegistration | undefined,
  params: Readonly<Record<string, unknown>>,
  title: string
): PanelTabChrome | undefined {
  if (!registration?.resolveTab) {
    return;
  }
  try {
    return normalizePanelTabChromeInput(
      registration.resolveTab({ params, title })
    );
  } catch (error) {
    console.error(
      `[plugins] failed to resolve tab chrome for ${registration.id}:`,
      error
    );
    return;
  }
}
