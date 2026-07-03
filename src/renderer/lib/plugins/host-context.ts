import type { PluginConfigurationApi } from "@plugins/api/configuration.ts";
import type {
  PluginPanelRegistration,
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginMessageValues,
  RendererPluginQuickPick,
  RendererPluginQuickPickItem,
  RendererPluginQuickPickSection,
} from "@plugins/api/renderer.ts";
import type { FileListRequest } from "@shared/contracts/file.ts";
import type { PanelContext } from "@shared/contracts/panel.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  collectEnabledConfigurationProperties,
  createConfigurationChangeEvent,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { toast } from "sonner";
import { terminalStatusItemRegistry } from "../../panel-kits/terminal/terminal-status-bar.tsx";
import { showAppAlert, showAppConfirm } from "../../stores/app-dialog.store.ts";
import {
  type PanelDescriptor,
  usePanelDescriptorStore,
} from "../../stores/panel-descriptor.store.ts";
import { usePluginRegistryStore } from "../../stores/plugin-registry.store.ts";
import {
  subscribePluginSettingsChanges,
  usePluginSettingsStore,
} from "../../stores/plugin-settings.store.ts";
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
  resolvePluginCommandAliases,
  resolvePluginCommandDisplay,
  resolvePluginMessage,
} from "./display.ts";
import { createPluginAiContext } from "./host-ai-context.ts";
import { createPluginGitContext } from "./host-git-context.ts";
import { createPluginOverlaysApi } from "./plugin-overlay-api.ts";
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

function pluginCommandAliases(
  entry: PluginRegistryEntry | undefined,
  commandId: string
): readonly string[] {
  const command = entry?.manifest.commands.find(
    (item) => item.id === commandId
  );
  if (!(entry && command)) {
    return [];
  }
  return resolvePluginCommandAliases(
    entry.manifest,
    command,
    i18next.language || "en"
  );
}

function adaptActionMetadata(
  metadata: RendererPluginAction["metadata"],
  entry: PluginRegistryEntry | undefined,
  actionId: string
): ActionMetadata | undefined {
  const hasPluginCommandAliases =
    entry?.manifest.commands.some((command) => command.id === actionId) ??
    false;
  if (!(metadata || hasPluginCommandAliases)) {
    return;
  }
  const adapted: ActionMetadata = {};
  if (hasPluginCommandAliases) {
    adapted.aliases = () => pluginCommandAliases(entry, actionId);
  }
  if (metadata?.categoryKey) {
    adapted.categoryKey = metadata.categoryKey;
  }
  if (metadata?.excludeFromMru === true) {
    adapted.excludeFromMru = true;
  }
  if (metadata?.group) {
    adapted.group = metadata.group;
  }
  if (metadata?.iconComponent) {
    adapted.iconComponent = metadata.iconComponent;
  }
  if (metadata?.sortOrder != null) {
    adapted.sortOrder = metadata.sortOrder;
  }
  if (metadata?.submenu) {
    adapted.submenu = metadata.submenu;
  }
  return adapted;
}

function adaptAction(
  action: RendererPluginAction,
  entry: PluginRegistryEntry | undefined
): Action {
  const metadata = adaptActionMetadata(action.metadata, entry, action.id);
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

function assertPluginCapability(
  entry: PluginRegistryEntry | undefined,
  capability: PierCapability
): void {
  if (!entry || entry.effectivePermissions.includes(capability)) {
    return;
  }
  throw new Error(
    `plugin capability not granted: ${entry.manifest.id}:${capability}`
  );
}

function createPluginConfiguration(
  entry?: PluginRegistryEntry
): PluginConfigurationApi {
  const assertOwnedKey = (key: string): void => {
    // 与 assertDeclaredContribution 同惯例：宿主内部 context（无 entry）不受限。
    if (!entry) {
      return;
    }
    if (!key.startsWith(`${entry.manifest.id}.`)) {
      throw new Error(
        `plugin configuration key not owned: ${entry.manifest.id}:${key}`
      );
    }
  };
  const effectiveValue = (key: string): unknown => {
    const property = collectEnabledConfigurationProperties(
      usePluginRegistryStore.getState().plugins
    ).get(key);
    const userValue = usePluginSettingsStore.getState().values[key];
    return property
      ? effectiveConfigurationValue(property, userValue)
      : userValue;
  };
  return {
    get: <T>(key: string): T => effectiveValue(key) as T,
    onDidChange: (listener) =>
      subscribePluginSettingsChanges((changedKeys) => {
        listener(createConfigurationChangeEvent(changedKeys));
      }),
    reset: async (key) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().reset(key);
    },
    set: async (key, value) => {
      assertOwnedKey(key);
      await usePluginSettingsStore.getState().set(key, value);
    },
  };
}

function adaptQuickPickItem(item: RendererPluginQuickPickItem): QuickPickItem {
  return {
    id: item.id,
    label: item.label,
    ...(item.aliases ? { aliases: item.aliases } : {}),
    ...(item.badges ? { badges: item.badges } : {}),
    ...(item.checked == null ? {} : { checked: item.checked }),
    ...("data" in item ? { data: item.data } : {}),
    ...(item.description ? { description: item.description } : {}),
    ...(item.detail ? { detail: item.detail } : {}),
    ...(item.disabled == null ? {} : { disabled: item.disabled }),
    ...(item.icon ? { icon: item.icon } : {}),
    ...(item.searchTerms ? { searchTerms: item.searchTerms } : {}),
    ...(item.variant ? { variant: item.variant } : {}),
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
    ...(quickPick.renderItem
      ? {
          renderItem: (item: QuickPickItem) =>
            quickPick.renderItem?.(pluginItemFor(item)),
        }
      : {}),
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

function pluginPanelDescriptor(
  panelId: string,
  registration: PluginPanelRegistration | undefined,
  context: PanelContext | undefined
): PanelDescriptor {
  return {
    ...(context ? { context } : {}),
    display: { short: resolveRegistrationTitle(registration, panelId) },
  };
}

function normalizeFileListRequest(
  requestOrRoot: FileListRequest | string,
  options?: { path?: string }
): FileListRequest {
  if (typeof requestOrRoot !== "string") {
    return requestOrRoot;
  }
  return {
    path: options?.path ?? "",
    root: requestOrRoot,
  };
}

function openPluginPanel(
  panelId: string,
  options: { context?: PanelContext } = {}
): void {
  const api = useWorkspaceStore.getState().api;
  if (!api) {
    return;
  }
  const registration = getPluginPanelRegistrations().get(panelId);
  const descriptorStore = usePanelDescriptorStore.getState();
  // 无来源 context 时保留 panel 已存的 context,避免重开时被抹掉。
  const context =
    options.context ?? descriptorStore.descriptors[panelId]?.context;
  descriptorStore.upsert(
    panelId,
    pluginPanelDescriptor(panelId, registration, context)
  );
  const params = {
    ...(registration?.getParams?.() ?? {}),
    ...(context ? { context } : {}),
  };
  const hasParams = Object.keys(params).length > 0;
  const existing = api.panels.find((panel) => panel.id === panelId);
  if (existing) {
    existing.api.updateParameters(params);
    activateWorkspacePanel(api, existing.id, { reveal: "always" });
    return;
  }
  api.addPanel({
    id: panelId,
    component: panelId,
    title: resolveRegistrationTitle(registration, panelId),
    position: { direction: "right" },
    ...(hasParams ? { params } : {}),
  });
  scheduleRevealDockviewTabByPanelId(panelId);
}

function toastNotificationOptions(options?: {
  description?: string;
}): { description: string } | undefined {
  const description = options?.description?.trim();
  return description ? { description } : undefined;
}

export function createRendererPluginContext(
  entry?: PluginRegistryEntry
): RendererPluginContext {
  return {
    actions: {
      register: (action) => {
        assertDeclaredContribution(entry, "action", action.id);
        return actionRegistry.register(adaptAction(action, entry));
      },
    },
    commandPalette: {
      openQuickPick: (quickPick) =>
        useCommandPaletteController
          .getState()
          .openQuickPick(adaptQuickPick(quickPick)),
    },
    configuration: createPluginConfiguration(entry),
    dialogs: {
      alert: (options) => showAppAlert(options),
      confirm: (options) => showAppConfirm(options),
    },
    i18n: createPluginI18n(entry),
    notifications: {
      error: (message, options) => {
        toast.error(message, toastNotificationOptions(options));
      },
      info: (message, options) => {
        toast.info(message, toastNotificationOptions(options));
      },
      loading: (message) => {
        const id = toast.loading(message);
        return {
          dismiss: () => {
            toast.dismiss(id);
          },
          info: (update) => {
            toast.info(update, { id });
          },
          success: (update) => {
            toast.success(update, { id });
          },
        };
      },
      success: (message, options) => {
        toast.success(message, toastNotificationOptions(options));
      },
      system: (options) => window.pier.notifications.system(options),
    },
    overlays: createPluginOverlaysApi(entry),
    panels: {
      getActiveContext: () => {
        const state = usePanelDescriptorStore.getState();
        return state.activeId
          ? (state.descriptors[state.activeId]?.context ?? null)
          : null;
      },
      open: (panelId, options) => {
        // 与 register 对称:必须在自己 manifest 声明的 panel 才能打开,
        // 防止 A 插件越权打开 B 插件的 panel。
        assertDeclaredContribution(entry, "panel", panelId);
        openPluginPanel(panelId, options);
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
    files: {
      list: (requestOrRoot, options) => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.list(
          normalizeFileListRequest(requestOrRoot, options)
        );
      },
      move: (request) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.move(request);
      },
      readText: (request) => {
        assertPluginCapability(entry, "file:read");
        return window.pier.files.readText(request);
      },
      rename: (request) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.rename(request);
      },
      trash: (request) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.trash(request);
      },
      writeText: (request) => {
        assertPluginCapability(entry, "file:write");
        return window.pier.files.writeText(request);
      },
    },
    worktrees: {
      check: (request) => window.pier.worktrees.check(request),
      create: (request) => window.pier.worktrees.create(request),
      creationDefaults: () => window.pier.worktrees.creationDefaults(),
      list: (request) => window.pier.worktrees.list(request),
      open: (request) => window.pier.worktrees.open(request),
      openTerminal: (request) => window.pier.worktrees.openTerminal(request),
      prune: (request) => window.pier.worktrees.prune(request),
      remove: (request) => window.pier.worktrees.remove(request),
    },
    git: createPluginGitContext(entry, assertPluginCapability),
    ai: createPluginAiContext(entry, assertPluginCapability),
  };
}
