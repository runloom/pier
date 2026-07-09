import type {
  RendererMissionControlWidgetRegistration as ExternalMissionControlWidgetRegistration,
  RendererPluginAction as ExternalPluginAction,
  ExternalRendererPluginContext,
  RendererSettingsPageRegistration as ExternalSettingsPageRegistration,
} from "@pier/plugin-api/renderer";
import type {
  MissionControlWidgetComponentProps as HostMissionControlWidgetComponentProps,
  MissionControlWidgetSettingsProps as HostMissionControlWidgetSettingsProps,
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
import { registerPluginMissionControlWidget } from "./plugin-mission-control-widget-registry.ts";
import {
  getPluginSettingsPage,
  registerPluginSettingsPage,
} from "./plugin-settings-page-registry.ts";

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
  kind: "action" | "missionControlWidget" | "settingsPage",
  id: string
): void {
  let declared: ReadonlyArray<{ id: string }>;
  if (kind === "action") {
    declared = entry.manifest.commands;
  } else if (kind === "missionControlWidget") {
    declared = entry.manifest.missionControlWidgets;
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
  getEntries: () => readonly PluginRegistryEntry[]
): ExternalRendererPluginContext {
  const pluginId = entry.manifest.id;

  return {
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
        return actionRegistry.register({
          category: action.category ?? "run",
          id: action.id,
          title: () => resolveTitle(action.title),
          handler: () => {
            Promise.resolve(action.invoke()).catch((err: unknown) => {
              console.error(`[${pluginId}] action ${action.id} failed:`, err);
            });
          },
        });
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
        usePluginSettingsStore.subscribe((state, prev) => {
          const changedKeys: string[] = [];
          for (const key of Object.keys(state.values)) {
            if (state.values[key] !== prev.values[key]) changedKeys.push(key);
          }
          if (changedKeys.length > 0) {
            listener({ changedKeys });
          }
        }),
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
    missionControlWidgets: {
      register: (registration: ExternalMissionControlWidgetRegistration) => {
        assertDeclared(entry, "missionControlWidget", registration.id);
        const title = registration.title;
        return registerPluginMissionControlWidget({
          component:
            registration.component as FunctionComponent<HostMissionControlWidgetComponentProps>,
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
                  registration.settingsComponent as FunctionComponent<HostMissionControlWidgetSettingsProps>,
              }
            : {}),
          // 省略 title = 用 manifest 本地化标题（宿主 merge 层解析）
          ...(title === undefined ? {} : { title: () => resolveTitle(title) }),
        });
      },
    },
    settingsPages: {
      register: (registration: ExternalSettingsPageRegistration) => {
        assertDeclared(entry, "settingsPage", registration.id);
        if (getPluginSettingsPage(pluginId)) {
          throw new Error(
            `plugin ${pluginId} already registered a settings page`
          );
        }
        return registerPluginSettingsPage(pluginId, registration);
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
    notifications: {
      error: (message) => toast.error(message),
      info: (message) => toast.info(message),
      success: (message) => toast.success(message),
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
        bridge.subscribe(pluginId, event, (payload) => callback(payload as T)),
    },
  };
}
