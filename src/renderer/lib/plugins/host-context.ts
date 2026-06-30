import type {
  PluginPanelRegistration,
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginMessageValues,
  RendererPluginQuickPick,
  RendererPluginQuickPickItem,
  RendererPluginQuickPickSection,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { terminalStatusItemRegistry } from "../../panel-kits/terminal/terminal-status-bar.tsx";
import { usePanelDescriptorStore } from "../../stores/panel-descriptor.store.ts";
import { useWorkspaceStore } from "../../stores/workspace.store.ts";
import { actionRegistry } from "../actions/registry.ts";
import type { Action, ActionMetadata } from "../actions/types.ts";
import { useCommandPaletteController } from "../command-palette/controller.ts";
import type {
  QuickPick,
  QuickPickItem,
  QuickPickSection,
} from "../command-palette/types.ts";
import { activateWorkspacePanel } from "../workspace/panel-activation.ts";
import { scheduleRevealDockviewTabByPanelId } from "../workspace/tab-visibility.ts";
import {
  resolvePluginCommandDisplay,
  resolvePluginMessage,
} from "./display.ts";
import {
  getPluginPanelRegistrations,
  registerPluginPanel,
} from "./plugin-panel-registry.ts";

function createPluginI18n(
  entry?: PluginRegistryEntry
): RendererPluginContext["i18n"] {
  const language = () => i18next.language || "en";
  const commandById = (commandId: string) =>
    entry?.manifest.commands.find((command) => command.id === commandId);

  return {
    commandDescription: (commandId) => {
      const command = commandById(commandId);
      if (!(entry && command)) {
        return;
      }
      return resolvePluginCommandDisplay(entry.manifest, command, language())
        .description;
    },
    commandTitle: (commandId, fallback = commandId) => {
      const command = commandById(commandId);
      if (!(entry && command)) {
        return fallback;
      }
      return resolvePluginCommandDisplay(entry.manifest, command, language())
        .title;
    },
    language,
    t: (key: string, values?: RendererPluginMessageValues, fallback = key) =>
      entry
        ? (resolvePluginMessage(entry.manifest, language(), key, values) ??
          fallback)
        : fallback,
  };
}

function adaptActionMetadata(
  metadata: RendererPluginAction["metadata"]
): ActionMetadata | undefined {
  if (!metadata) {
    return;
  }
  const adapted: ActionMetadata = {};
  if (metadata.aliases) {
    adapted.aliases = metadata.aliases;
  }
  if (metadata.categoryKey) {
    adapted.categoryKey = metadata.categoryKey;
  }
  if (metadata.excludeFromMru === true) {
    adapted.excludeFromMru = true;
  }
  if (metadata.group) {
    adapted.group = metadata.group;
  }
  if (metadata.iconComponent) {
    adapted.iconComponent = metadata.iconComponent;
  }
  if (metadata.sortOrder != null) {
    adapted.sortOrder = metadata.sortOrder;
  }
  if (metadata.submenu) {
    adapted.submenu = metadata.submenu;
  }
  return adapted;
}

function adaptAction(action: RendererPluginAction): Action {
  const metadata = adaptActionMetadata(action.metadata);
  return {
    category: action.category,
    handler: action.handler,
    id: action.id,
    ...(action.disabledReason ? { disabledReason: action.disabledReason } : {}),
    ...(action.enabled ? { enabled: action.enabled } : {}),
    ...(metadata ? { metadata } : {}),
    ...(action.surfaces ? { surfaces: action.surfaces } : {}),
    title: action.title,
  };
}

function assertDeclaredContribution(
  entry: PluginRegistryEntry | undefined,
  kind: "action" | "panel" | "terminalStatusItem",
  id: string
): void {
  if (!entry) {
    return;
  }
  let declared: boolean;
  if (kind === "action") {
    declared = entry.manifest.commands.some((command) => command.id === id);
  } else if (kind === "panel") {
    declared = entry.manifest.panels.some((panel) => panel.id === id);
  } else {
    declared = entry.manifest.terminalStatusItems.some(
      (item) => item.id === id
    );
  }
  if (!declared) {
    throw new Error(
      `plugin contribution not declared: ${entry.manifest.id}:${kind}:${id}`
    );
  }
}

function adaptQuickPickItem(item: RendererPluginQuickPickItem): QuickPickItem {
  return {
    id: item.id,
    label: item.label,
    ...(item.aliases ? { aliases: item.aliases } : {}),
    ...(item.badges ? { badges: item.badges } : {}),
    ...(item.checked == null ? {} : { checked: item.checked }),
    ...(item.description ? { description: item.description } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.disabled == null ? {} : { disabled: item.disabled }),
    ...(item.searchTerms ? { searchTerms: item.searchTerms } : {}),
  };
}

function adaptQuickPickSection(
  section: RendererPluginQuickPickSection
): QuickPickSection {
  return {
    heading: section.heading,
    id: section.id,
    items: section.items.map(adaptQuickPickItem),
  };
}

function indexPluginQuickPickItems(
  quickPick: RendererPluginQuickPick
): ReadonlyMap<string, RendererPluginQuickPickItem> {
  const items = [
    ...(quickPick.items ?? []),
    ...(quickPick.sections?.flatMap((section) => section.items) ?? []),
  ];
  return new Map(items.map((item) => [item.id, item]));
}

function adaptQuickPick(quickPick: RendererPluginQuickPick): QuickPick {
  const pluginItemsById = indexPluginQuickPickItems(quickPick);
  const pluginItemFor = (item: QuickPickItem) =>
    pluginItemsById.get(item.id) ?? item;
  return {
    onAccept: (item) => quickPick.onAccept(pluginItemFor(item)),
    ...(quickPick.items
      ? { items: quickPick.items.map(adaptQuickPickItem) }
      : {}),
    ...(quickPick.onChangeSelection
      ? {
          onChangeSelection: (item: QuickPickItem) =>
            quickPick.onChangeSelection?.(pluginItemFor(item)),
        }
      : {}),
    ...(quickPick.onDismiss ? { onDismiss: quickPick.onDismiss } : {}),
    ...(quickPick.placeholder ? { placeholder: quickPick.placeholder } : {}),
    ...(quickPick.sections
      ? { sections: quickPick.sections.map(adaptQuickPickSection) }
      : {}),
    title: quickPick.title,
  };
}

function resolveRegistrationTitle(
  registration: PluginPanelRegistration | undefined,
  fallback: string
): string {
  const title = registration?.title;
  if (typeof title === "function") {
    return title();
  }
  return title ?? fallback;
}

function openPluginPanel(panelId: string): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const existing = api.panels.find((panel) => panel.id === panelId);
  if (existing) {
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  const registration = getPluginPanelRegistrations().get(panelId);
  const params = registration?.getParams?.();
  api.addPanel({
    id: panelId,
    component: panelId,
    title: resolveRegistrationTitle(registration, panelId),
    position: { direction: "right" },
    ...(params ? { params } : {}),
  });
  scheduleRevealDockviewTabByPanelId(panelId);
}

export function createRendererPluginContext(
  entry?: PluginRegistryEntry
): RendererPluginContext {
  return {
    actions: {
      register: (action) => {
        assertDeclaredContribution(entry, "action", action.id);
        return actionRegistry.register(adaptAction(action));
      },
    },
    commandPalette: {
      openQuickPick: (quickPick) =>
        useCommandPaletteController
          .getState()
          .openQuickPick(adaptQuickPick(quickPick)),
    },
    i18n: createPluginI18n(entry),
    panels: {
      getActiveContext: () => {
        const state = usePanelDescriptorStore.getState();
        return state.activeId
          ? (state.descriptors[state.activeId]?.context ?? null)
          : null;
      },
      open: (panelId) => {
        // 与 register 对称:必须在自己 manifest 声明的 panel 才能打开,
        // 防止 A 插件越权打开 B 插件的 panel。
        assertDeclaredContribution(entry, "panel", panelId);
        openPluginPanel(panelId);
      },
      register: (registration: PluginPanelRegistration) => {
        assertDeclaredContribution(entry, "panel", registration.id);
        return registerPluginPanel(registration);
      },
    },
    terminalStatusItems: {
      register: (item) => {
        assertDeclaredContribution(entry, "terminalStatusItem", item.id);
        return terminalStatusItemRegistry.register(item);
      },
    },
    worktrees: {
      check: (request) => window.pier.worktrees.check(request),
      list: (request) => window.pier.worktrees.list(request),
      open: (request) => window.pier.worktrees.open(request),
    },
    git: {
      getStatus: (cwd) => window.pier.git.getStatus(cwd),
      getRepoInfo: (cwd) => window.pier.git.getRepoInfo(cwd),
      watch: (gitRoot, listener) => window.pier.git.watch(gitRoot, listener),
    },
  };
}
