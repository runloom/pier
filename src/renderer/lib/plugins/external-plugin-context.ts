import type {
  RendererPluginAction as ExternalPluginAction,
  RendererPluginPanelRegistration as ExternalPluginPanelRegistration,
  RendererPluginQuickPick as ExternalPluginQuickPick,
  ExternalRendererPluginContext,
  RendererSettingsPageRegistration as ExternalSettingsPageRegistration,
  RendererWorkbenchWidgetRegistration as ExternalWorkbenchWidgetRegistration,
} from "@pier/plugin-api/renderer";
import type {
  RendererPluginQuickPick as HostPluginQuickPick,
  WorkbenchWidgetComponentProps as HostWorkbenchWidgetComponentProps,
  WorkbenchWidgetSettingsProps as HostWorkbenchWidgetSettingsProps,
} from "@plugins/api/renderer.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import {
  collectEnabledConfigurationProperties,
  effectiveConfigurationValue,
} from "@shared/plugin-settings.ts";
import i18next from "i18next";
import { KeyRound, type LucideIcon } from "lucide-react";
import type { FunctionComponent } from "react";
import { toast } from "sonner";
import { actionRegistry } from "@/lib/actions/registry.ts";
import {
  closeAppContentDialog,
  openAppContentDialog,
  updateAppContentDialog,
} from "@/stores/app-content-dialog.store.ts";
import {
  showAppAlert,
  showAppChoice,
  showAppConfirm,
  showAppPrompt,
} from "@/stores/app-dialog.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { resolvePluginMessage } from "./display.ts";
import type { ExternalRendererActivationScope } from "./external-activation-scope.ts";
import { createPluginCommandPaletteContext } from "./host-command-palette-context.ts";
import { pluginLifecycleBarriers } from "./plugin-lifecycle-barriers.ts";
import {
  getPluginSettingsPage,
  registerPluginSettingsPage,
} from "./plugin-settings-page-registry.ts";
import {
  assertPluginWorkbenchWidgetRegistration,
  registerPluginWorkbenchWidget,
} from "./plugin-workbench-widget-registry.ts";

/**
 * Builds a plugin-scoped `ExternalRendererPluginContext`. The plugin id is
 * injected here — plugins never set it themselves (design §7.3).
 */

export interface RendererPluginRpcBridge {
  invoke(pluginId: string, method: string, payload: unknown): Promise<unknown>;
  subscribe(
    pluginId: string,
    event: string,
    callback: (payload: unknown) => void
  ): () => void;
}

function assertDeclared(
  entry: PluginRegistryEntry,
  kind: "action" | "panel" | "settingsPage",
  id: string
): void {
  let declared: ReadonlyArray<{ id: string }>;
  if (kind === "action") {
    declared = entry.manifest.commands;
  } else if (kind === "panel") {
    declared = entry.manifest.panels;
  } else {
    declared = entry.manifest.settingsPages;
  }
  if (!declared.some((c) => c.id === id)) {
    throw new Error(
      `plugin ${entry.manifest.id} tried to register undeclared ${kind}: ${id}`
    );
  }
}

function assertOwnedKey(entry: PluginRegistryEntry, key: string): void {
  const prefix = `${entry.manifest.id}.`;
  if (!key.startsWith(prefix)) {
    throw new Error(
      `plugin ${entry.manifest.id} accessed non-owned configuration key: ${key}`
    );
  }
}

function resolveTitle(title: string | (() => string)): string {
  return typeof title === "function" ? title() : title;
}

export function createExternalRendererPluginContext(
  entry: PluginRegistryEntry,
  bridge: RendererPluginRpcBridge,
  getEntries: () => readonly PluginRegistryEntry[],
  scope?: ExternalRendererActivationScope,
  registerPanel?: (registration: ExternalPluginPanelRegistration) => () => void
): ExternalRendererPluginContext {
  const pluginId = entry.manifest.id;
  const track = (dispose: () => void): (() => void) =>
    scope?.add(dispose) ?? dispose;
  const hostCommandPalette = createPluginCommandPaletteContext();
  const workbenchWidgets: ExternalRendererPluginContext["workbenchWidgets"] = {
    register: (registration: ExternalWorkbenchWidgetRegistration) => {
      assertPluginWorkbenchWidgetRegistration(entry, registration);
      const title = registration.title;
      return track(
        registerPluginWorkbenchWidget({
          ...(registration.actions
            ? {
                actions: registration.actions as NonNullable<
                  import("@plugins/api/renderer.ts").RendererWorkbenchWidgetRegistration["actions"]
                >,
              }
            : {}),
          component:
            registration.component as FunctionComponent<HostWorkbenchWidgetComponentProps>,
          icon: (registration.icon ?? KeyRound) as LucideIcon,
          id: registration.id,
          ...(registration.previewComponent
            ? {
                previewComponent:
                  registration.previewComponent as FunctionComponent,
              }
            : {}),
          ...(registration.settingsComponent
            ? {
                settingsComponent:
                  registration.settingsComponent as FunctionComponent<HostWorkbenchWidgetSettingsProps>,
              }
            : {}),
          ...(title === undefined ? {} : { title: () => resolveTitle(title) }),
        })
      );
    },
  };

  const context: ExternalRendererPluginContext = {
    app: {
      closeSettings: () => {
        useSettingsDialogStore.getState().close();
      },
      openExternal: async (url) => {
        if (!entry.manifest.permissions.includes("external:open")) {
          throw new Error(
            `plugin capability not granted: ${pluginId}:external:open`
          );
        }
        const result = await window.pier.externalNavigation.open(url);
        return result.opened;
      },
      openSettings: (options) => {
        useSettingsDialogStore
          .getState()
          .openSection(options?.section ?? "appearance");
      },
    },
    actions: {
      register: (action: ExternalPluginAction) => {
        assertDeclared(entry, "action", action.id);
        return track(
          actionRegistry.register({
            category: action.category ?? "run",
            id: action.id,
            // 外部插件动作的入口就是命令面板；不带 surface 会被
            // actionRegistry.list("command-palette") 过滤而不可见。
            surfaces: ["command-palette"],
            title: () => resolveTitle(action.title),
            handler: () =>
              Promise.resolve(action.invoke()).catch((err: unknown) => {
                console.error(`[${pluginId}] action ${action.id} failed:`, err);
                throw err;
              }),
          })
        );
      },
    },
    configuration: {
      get: <T>(key: string): T => {
        const properties = collectEnabledConfigurationProperties(getEntries());
        const property = properties.get(key);
        const userValue = usePluginSettingsStore.getState().values[key];
        return (
          property
            ? effectiveConfigurationValue(property, userValue)
            : userValue
        ) as T;
      },
      onDidChange: (listener) =>
        track(
          usePluginSettingsStore.subscribe((state, prev) => {
            const changedKeys: string[] = [];
            for (const key of Object.keys(state.values)) {
              if (state.values[key] !== prev.values[key]) changedKeys.push(key);
            }
            if (changedKeys.length > 0) {
              listener({ changedKeys });
            }
          })
        ),
      reset: async (key) => {
        assertOwnedKey(entry, key);
        await usePluginSettingsStore.getState().reset(key);
      },
      set: async (key, value) => {
        assertOwnedKey(entry, key);
        // Plugin settings store's value type is JsonValue; runtime coerces via schema.
        await usePluginSettingsStore.getState().set(key, value as never);
      },
    },
    commandPalette: {
      openQuickPick: (quickPick: ExternalPluginQuickPick) => {
        hostCommandPalette.openQuickPick(
          quickPick as unknown as HostPluginQuickPick
        );
      },
      updateQuickPick: (patch, options) => {
        hostCommandPalette.updateQuickPick(
          patch as Partial<HostPluginQuickPick>,
          options
        );
      },
    },
    workbenchWidgets,
    settingsPages: {
      register: (registration: ExternalSettingsPageRegistration) => {
        assertDeclared(entry, "settingsPage", registration.id);
        if (getPluginSettingsPage(pluginId)) {
          throw new Error(
            `plugin ${pluginId} already registered a settings page`
          );
        }
        return track(registerPluginSettingsPage(pluginId, registration));
      },
    },
    dialogs: {
      alert: (options) => {
        const args: {
          body?: string;
          confirmLabel?: string;
          intent?: "default" | "destructive";
          size?: "default" | "sm";
          title: string;
        } = {
          title: options.title,
          // Long error bodies need default width; callers may opt into sm.
          size: options.size ?? "default",
        };
        if (options.body !== undefined) args.body = options.body;
        if (options.confirmLabel !== undefined) {
          args.confirmLabel = options.confirmLabel;
        }
        if (options.intent !== undefined) args.intent = options.intent;
        return showAppAlert(args);
      },
      choice: (options) => showAppChoice(options),
      confirm: (options) => {
        const args: {
          body?: string;
          cancelLabel?: string;
          confirmLabel?: string;
          intent: "default" | "destructive";
          size: "default" | "sm";
          title: string;
        } = {
          intent: options.intent,
          size: options.size,
          title: options.title,
        };
        if (options.body !== undefined) args.body = options.body;
        if (options.cancelLabel !== undefined) {
          args.cancelLabel = options.cancelLabel;
        }
        if (options.confirmLabel !== undefined) {
          args.confirmLabel = options.confirmLabel;
        }
        return showAppConfirm(args);
      },
      open: (request) =>
        openAppContentDialog({
          ...request,
          namespace: pluginId,
        }),
      prompt: (options) => showAppPrompt(options),
      update: (id, patch) =>
        updateAppContentDialog(
          id.includes(":") ? id : `${pluginId}:${id}`,
          patch
        ),
      close: (id, result) =>
        closeAppContentDialog(
          id.includes(":") ? id : `${pluginId}:${id}`,
          result
        ),
    },
    i18n: {
      language: () => i18next.language || "en",
      t: (key, fallback) => {
        const resolved = resolvePluginMessage(
          entry.manifest,
          i18next.language || "en",
          key
        );
        return resolved ?? fallback ?? key;
      },
    },
    lifecycle: {
      beforeSuspend: (barrier) =>
        track(pluginLifecycleBarriers.register(pluginId, barrier)),
    },
    notifications: {
      error: (message) => toast.error(message),
      info: (message) => toast.info(message),
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
      success: (message) => toast.success(message),
    },
    panels: {
      register: (registration: ExternalPluginPanelRegistration) => {
        assertDeclared(entry, "panel", registration.id);
        if (!registration.id.startsWith(`${pluginId}.`)) {
          throw new Error(
            `external panel id must start with ${pluginId}.: ${registration.id}`
          );
        }
        if (!entry.effectivePermissions.includes("panel:register")) {
          throw new Error(
            `plugin capability not granted: ${pluginId}:panel:register`
          );
        }
        if (!registerPanel) {
          throw new Error(`external panel host is unavailable: ${pluginId}`);
        }
        return track(registerPanel(registration));
      },
    },
    terminals: {
      open: (request) =>
        Promise.resolve().then(() => {
          if (!entry.effectivePermissions.includes("terminal:control")) {
            throw new Error(
              `plugin capability not granted: ${pluginId}:terminal:control`
            );
          }
          return window.pier.terminals.open(request ?? {});
        }),
    },
    rpc: {
      invoke: async <T>(method: string, payload?: unknown): Promise<T> => {
        const result = await bridge.invoke(pluginId, method, payload ?? null);
        if (!result || typeof result !== "object" || !("ok" in result)) {
          throw new Error("plugin RPC returned invalid envelope");
        }
        if (result.ok === false) {
          const err = "error" in result ? result.error : null;
          if (
            err &&
            typeof err === "object" &&
            "message" in err &&
            typeof err.message === "string"
          ) {
            throw new Error(err.message);
          }
          throw new Error("plugin RPC returned error");
        }
        if (!("data" in result)) {
          throw new Error("plugin RPC ok=true missing data");
        }
        return result.data as T;
      },
      on: <T>(event: string, callback: (payload: T) => void): (() => void) =>
        track(
          bridge.subscribe(pluginId, event, (payload) => callback(payload as T))
        ),
    },
  };

  // 只给已安装的 apiVersion 1 旧包提供不可枚举运行时别名；公开类型和新包只使用新键。
  Object.defineProperty(context, "missionControlWidgets", {
    configurable: false,
    enumerable: false,
    value: workbenchWidgets,
    writable: false,
  });
  return context;
}
