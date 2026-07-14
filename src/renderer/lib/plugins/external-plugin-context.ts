import type {
  RendererPluginAction as ExternalPluginAction,
  RendererPluginPanelRegistration as ExternalPluginPanelRegistration,
  ExternalRendererPluginContext,
  RendererSettingsPageRegistration as ExternalSettingsPageRegistration,
  RendererWorkbenchWidgetRegistration as ExternalWorkbenchWidgetRegistration,
} from "@pier/plugin-api/renderer";
import type {
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
import { showAppAlert, showAppConfirm } from "@/stores/app-dialog.store.ts";
import { usePluginSettingsStore } from "@/stores/plugin-settings.store.ts";
import { useSettingsDialogStore } from "@/stores/settings-dialog.store.ts";
import { resolvePluginMessage } from "./display.ts";
import type { ExternalRendererActivationScope } from "./external-activation-scope.ts";
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
            title: () => resolveTitle(action.title),
            handler: () => {
              Promise.resolve(action.invoke()).catch((err: unknown) => {
                console.error(`[${pluginId}] action ${action.id} failed:`, err);
              });
            },
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
        const args: { body?: string; size: "sm"; title: string } = {
          size: "sm",
          title: options.title,
        };
        if (options.body !== undefined) args.body = options.body;
        return showAppAlert(args);
      },
      confirm: (options) => {
        const args: {
          body?: string;
          intent: "default" | "destructive";
          size: "sm";
          title: string;
        } = {
          intent: options.intent ?? "default",
          size: "sm",
          title: options.title,
        };
        if (options.body !== undefined) args.body = options.body;
        return showAppConfirm(args);
      },
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
