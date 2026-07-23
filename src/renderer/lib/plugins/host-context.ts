import type {
  RendererPluginAction,
  RendererPluginContext,
  RendererPluginMessageValues,
} from "@plugins/api/renderer.ts";
import type { PierCapability } from "@shared/contracts/permissions.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { toast } from "sonner";
import {
  closeContentPreview,
  openImagePreview,
} from "@/components/common/content-preview.ts";
import { useZoomStore } from "@/stores/zoom.store.ts";
import { terminalStatusItemRegistry } from "../../panel-kits/terminal/terminal-status-bar.tsx";
import {
  closeAppContentDialog,
  openAppContentDialog,
  updateAppContentDialog,
} from "../../stores/app-content-dialog.store.ts";
import {
  showAppAlert,
  showAppChoice,
  showAppConfirm,
  showAppPrompt,
} from "../../stores/app-dialog.store.ts";
import { useSettingsDialogStore } from "../../stores/settings-dialog.store.ts";
import { actionRegistry } from "../actions/registry.ts";
import type { Action, ActionMetadata } from "../actions/types.ts";
import {
  registerSelectionSelectAllProvider,
  registerSelectionTextProvider,
} from "../context-menu/selection-text.ts";
import { popupContextMenuAt } from "../context-menu/use-context-menu.ts";
import { cssPointToContentViewPoint } from "../window-zoom/coordinates.ts";
import {
  interpolateMessage,
  resolvePluginCommandAliases,
  resolvePluginCommandDisplay,
  resolvePluginMessage,
} from "./display.ts";
import { createPluginAgentsContext } from "./host-agents-context.ts";
import { createPluginAiContext } from "./host-ai-context.ts";
import {
  createPluginAppearanceContext,
  createPluginChartsContext,
} from "./host-appearance-context.ts";
import { createPluginCommandPaletteContext } from "./host-command-palette-context.ts";
import { createPluginConfiguration } from "./host-configuration-context.ts";
import { createPluginEnvironmentsContext } from "./host-environments-context.ts";
import { createPluginFilesContext } from "./host-files-context.ts";
import { createPluginGitContext } from "./host-git-context.ts";
import { createHostGroupContentContext } from "./host-group-content-context.tsx";
import { createPluginPanelsContext } from "./host-panels-context.ts";
import { createPluginTerminalContext } from "./host-terminal-context.ts";
import { createPluginTerminalsContext } from "./host-terminals-context.ts";
import { createPluginWorktreesContext } from "./host-worktree-context.ts";
import { pluginLifecycleBarriers } from "./plugin-lifecycle-barriers.ts";
import {
  assertPluginWorkbenchWidgetRegistration,
  registerPluginWorkbenchWidget,
} from "./plugin-workbench-widget-registry.ts";

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
    // fallback 也过插值：locale 缺 key 时用户不应看到字面 {{name}} 占位符。
    t: (
      key: string,
      values?: RendererPluginMessageValues,
      fallback = key,
      locale?: string
    ) =>
      entry
        ? (resolvePluginMessage(
            entry.manifest,
            locale ?? language(),
            key,
            values
          ) ?? interpolateMessage(fallback, values))
        : interpolateMessage(fallback, values),
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
  if (metadata?.menuHidden) {
    adapted.menuHidden = metadata.menuHidden;
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
  // 命令级 permissions 不再是纯声明:触发时逐项校验,与 manifest 单一真源。
  const declaredPermissions =
    entry?.manifest.commands.find((command) => command.id === action.id)
      ?.permissions ?? [];
  const handler: Action["handler"] =
    declaredPermissions.length > 0
      ? (invocation) => {
          for (const permission of declaredPermissions) {
            assertPluginCapability(entry, permission);
          }
          return action.handler(invocation);
        }
      : action.handler;
  return {
    category: action.category,
    handler,
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
  kind: "action" | "groupContent" | "panel" | "terminalStatusItem",
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
  } else if (kind === "groupContent") {
    declared = (entry.manifest.groupContent ?? []).some(
      (contribution) => contribution.id === id
    );
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

function toastNotificationOptions(options?: {
  action?: { label: string; onClick: () => void };
}): { action: { label: string; onClick: () => void } } | undefined {
  const action = options?.action;
  if (!action) {
    return;
  }
  return { action };
}

interface FilePreviewRuntimeLease {
  leaseId: string;
}

export function createRendererPluginContext(
  entry?: PluginRegistryEntry
): RendererPluginContext {
  let activeFilePreviewLease: FilePreviewRuntimeLease | null = null;
  let filePreviewLeasePromise: Promise<FilePreviewRuntimeLease | null> | null =
    null;
  let filePreviewSuspended = false;
  let resolveFilePreviewSuspension: ((resumed: boolean) => void) | null = null;
  let filePreviewSuspension: Promise<boolean> | null = null;
  const acquireFilePreviewLease =
    async (): Promise<FilePreviewRuntimeLease | null> => {
      if (filePreviewSuspended) {
        const resumed = await filePreviewSuspension;
        return resumed ? acquireFilePreviewLease() : null;
      }
      if (!filePreviewLeasePromise) {
        filePreviewLeasePromise = entry
          ? window.pier.filePreviews
              .acquire(entry.manifest.id)
              .then(async (result) => {
                if (!result.acquired) {
                  filePreviewLeasePromise = null;
                  return null;
                }
                const lease = { leaseId: result.leaseId };
                if (filePreviewSuspended) {
                  const resumed = await filePreviewSuspension;
                  if (!resumed) {
                    await window.pier.filePreviews.revoke(lease.leaseId);
                    filePreviewLeasePromise = null;
                    return null;
                  }
                }
                activeFilePreviewLease = lease;
                return lease;
              })
          : Promise.resolve(null);
      }
      return filePreviewLeasePromise;
    };
  const revokeFilePreviewLease = async () => {
    const lease = await filePreviewLeasePromise;
    activeFilePreviewLease = null;
    filePreviewLeasePromise = null;
    if (lease) {
      await window.pier.filePreviews.revoke(lease.leaseId);
    }
  };
  const settleFilePreviewSuspension = (resumed: boolean) => {
    filePreviewSuspended = !resumed;
    resolveFilePreviewSuspension?.(resumed);
    resolveFilePreviewSuspension = null;
    filePreviewSuspension = null;
  };
  if (entry) {
    pluginLifecycleBarriers.register(entry.manifest.id, {
      abort: () => settleFilePreviewSuspension(true),
      commit: async () => {
        settleFilePreviewSuspension(false);
        await revokeFilePreviewLease();
      },
      prepare: () => {
        filePreviewSuspended = true;
        filePreviewSuspension = new Promise<boolean>((resolve) => {
          resolveFilePreviewSuspension = resolve;
        });
      },
    });
  }
  return {
    actions: {
      register: (action) => {
        assertDeclaredContribution(entry, "action", action.id);
        assertPluginCapability(entry, "command:register");
        return actionRegistry.register(adaptAction(action, entry));
      },
    },
    agents: createPluginAgentsContext(),
    appearance: createPluginAppearanceContext(),
    commandPalette: createPluginCommandPaletteContext(),
    charts: createPluginChartsContext(),
    contextMenu: {
      popup: (surface, coords, invocation) => {
        const zoomLevel = useZoomStore.getState().windowZoomLevel;
        const contentPoint = cssPointToContentViewPoint(coords, zoomLevel);
        return popupContextMenuAt(surface, contentPoint, invocation);
      },
      registerSelectionSelectAllProvider: (panelId, provider) =>
        registerSelectionSelectAllProvider(panelId, provider),
      registerSelectionTextProvider: (panelId, provider) =>
        registerSelectionTextProvider(panelId, provider),
    },
    configuration: createPluginConfiguration(entry),
    dialogs: {
      alert: (options) => showAppAlert(options),
      choice: (options) => showAppChoice(options),
      close: (id, result) =>
        closeAppContentDialog(
          entry && !id.includes(":") ? `${entry.manifest.id}:${id}` : id,
          result
        ),
      confirm: (options) => showAppConfirm(options),
      open: (request) =>
        openAppContentDialog({
          ...request,
          ...(entry ? { namespace: entry.manifest.id } : {}),
        }),
      prompt: (options) => showAppPrompt(options),
      update: (id, patch) =>
        updateAppContentDialog(
          entry && !id.includes(":") ? `${entry.manifest.id}:${id}` : id,
          patch
        ),
    },
    i18n: createPluginI18n(entry),
    lifecycle: {
      beforeSuspend: (barrier) =>
        entry
          ? pluginLifecycleBarriers.register(entry.manifest.id, barrier)
          : () => undefined,
    },
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
          update: (update) => {
            toast.loading(update, { id });
          },
        };
      },
      success: (message, options) => {
        toast.success(message, toastNotificationOptions(options));
      },
      system: (options) => window.pier.notifications.system(options),
    },
    panels: createPluginPanelsContext(
      entry,
      assertDeclaredContribution,
      assertPluginCapability
    ),
    settings: {
      openSection: (section) => {
        useSettingsDialogStore.getState().openSection(section);
      },
    },
    terminalStatusItems: {
      register: (item) => {
        assertDeclaredContribution(entry, "terminalStatusItem", item.id);
        return terminalStatusItemRegistry.register(item);
      },
    },
    workbenchWidgets: {
      register: (registration) => {
        assertPluginWorkbenchWidgetRegistration(entry, registration);
        return registerPluginWorkbenchWidget(registration);
      },
    },
    groupContent: createHostGroupContentContext(
      entry,
      assertDeclaredContribution
    ),
    environments: createPluginEnvironmentsContext(
      entry,
      assertPluginCapability
    ),
    externalNavigation: {
      open: async (url) => {
        assertPluginCapability(entry, "external:open");
        return window.pier.externalNavigation.open(url);
      },
    },
    filePreviews: {
      issue: async (locator, previousTicket) => {
        assertPluginCapability(entry, "file:read");
        const lease = await acquireFilePreviewLease();
        if (!lease || filePreviewSuspended) {
          return { issued: false, reason: "forbidden" };
        }
        return window.pier.filePreviews.issue({
          leaseId: lease.leaseId,
          locator,
          ...(previousTicket ? { previousTicket } : {}),
        });
      },
      release: async (ticket) => {
        assertPluginCapability(entry, "file:read");
        const lease = activeFilePreviewLease;
        return lease
          ? window.pier.filePreviews.release({ leaseId: lease.leaseId, ticket })
          : false;
      },
    },
    contentPreview: {
      close: () => {
        closeContentPreview();
      },
      openImage: (request) => {
        openImagePreview({
          ...(request.alt ? { alt: request.alt } : {}),
          ...(request.onClose ? { onClose: request.onClose } : {}),
          source: request.source,
          title: request.title,
        });
      },
    },
    files: createPluginFilesContext(entry, assertPluginCapability),
    terminal: createPluginTerminalContext(entry, assertPluginCapability),
    terminals: createPluginTerminalsContext(entry, assertPluginCapability),
    worktrees: createPluginWorktreesContext(entry, assertPluginCapability),
    git: createPluginGitContext(entry, assertPluginCapability),
    ai: createPluginAiContext(entry, assertPluginCapability),
  };
}
