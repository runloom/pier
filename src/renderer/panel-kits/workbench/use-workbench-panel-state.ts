import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { JsonValue } from "@shared/contracts/plugin-settings.ts";
import type {
  WorkbenchGridSize,
  WorkbenchPanelParams,
  WorkbenchPanelWidgetEntry,
} from "@shared/contracts/workbench.ts";
import {
  HOST_DEFAULT_WIDGET_SIZE,
  HOST_MAX_WIDGET_SIZE,
  HOST_MIN_WIDGET_SIZE,
  widgetEntryWidgetId,
} from "@shared/contracts/workbench.ts";
import i18next from "i18next";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { clampSize } from "./workbench-grid-geometry.ts";
import { moveWorkbenchEntry } from "./workbench-ordered-layout.ts";
import {
  canonicalizeWorkbenchPanelParams,
  findWidgetDeclaration as resolveWidgetDeclaration,
  type SizeDeclaration,
} from "./workbench-panel-state-normalization.ts";

export type { SizeDeclaration } from "./workbench-panel-state-normalization.ts";
export { findWidgetDeclaration } from "./workbench-panel-state-normalization.ts";

interface PanelParamsApi {
  updateParameters(params: Record<string, unknown>): void;
}

function newInstanceEntry(
  widgetId: string,
  declaration: SizeDeclaration | undefined
): WorkbenchPanelWidgetEntry {
  const size = clampSize(
    declaration?.defaultSize ?? HOST_DEFAULT_WIDGET_SIZE,
    declaration?.minSize ?? HOST_MIN_WIDGET_SIZE,
    declaration?.maxSize ?? HOST_MAX_WIDGET_SIZE
  );
  return {
    ...size,
    id: declaration?.multiInstance === true ? crypto.randomUUID() : widgetId,
    widgetId,
  };
}

interface LocalEchoState {
  latestVersion: number;
  nextVersion: number;
  versionsByWidgets: WeakMap<
    readonly unknown[],
    { paramsHash: string; version: number }
  >;
}

function resetLocalEchoState(state: LocalEchoState): void {
  state.latestVersion = 0;
  state.nextVersion = 0;
  state.versionsByWidgets = new WeakMap();
}

function getRawWidgetsIdentity(raw: unknown): readonly unknown[] | null {
  if (
    raw === null ||
    typeof raw !== "object" ||
    !("widgets" in raw) ||
    !Array.isArray(raw.widgets)
  ) {
    return null;
  }
  return raw.widgets;
}

export function useWorkbenchPanelState(
  params: unknown,
  api: PanelParamsApi,
  plugins: readonly PluginRegistryEntry[]
) {
  const [initialState] = useState(() => {
    const canonical = canonicalizeWorkbenchPanelParams(params, plugins);
    const echoState: LocalEchoState = {
      latestVersion: 0,
      nextVersion: 0,
      versionsByWidgets: new WeakMap(),
    };
    return { canonical, echoState };
  });
  const authoritativeParamsRef = useRef(initialState.canonical);
  const optimisticParamsRef = useRef(initialState.canonical);
  const [storedParams, setStoredParams] = useState(initialState.canonical);
  let renderedParams = storedParams;
  const [refreshTokens, setRefreshTokens] = useState<Record<string, number>>(
    {}
  );
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const localEchoStateRef = useRef(initialState.echoState);
  const apiRef = useRef(api);
  const pluginsRef = useRef(plugins);
  const observedApiRef = useRef(api);
  const observedParamsRef = useRef(params);
  const observedPluginsRef = useRef(plugins);
  const apiChanged = observedApiRef.current !== api;
  const paramsChanged = observedParamsRef.current !== params;
  const pluginsChanged = observedPluginsRef.current !== plugins;
  const incoming =
    apiChanged || paramsChanged
      ? canonicalizeWorkbenchPanelParams(params, plugins)
      : null;
  const widgetsIdentity = paramsChanged ? getRawWidgetsIdentity(params) : null;
  const echoState = localEchoStateRef.current;
  const marker = widgetsIdentity
    ? echoState.versionsByWidgets.get(widgetsIdentity)
    : undefined;
  const isLocalEcho =
    !apiChanged &&
    paramsChanged &&
    incoming !== null &&
    marker?.paramsHash === JSON.stringify(incoming);
  const replacesFromProps = apiChanged || (paramsChanged && !isLocalEcho);
  if (replacesFromProps && incoming) {
    renderedParams = incoming;
  } else if (pluginsChanged) {
    renderedParams = canonicalizeWorkbenchPanelParams(
      authoritativeParamsRef.current,
      plugins
    );
  }

  const applyParamsInMemory = useCallback((next: WorkbenchPanelParams) => {
    optimisticParamsRef.current = next;
    setStoredParams(next);
  }, []);
  const clearLocalEchoes = useCallback(() => {
    resetLocalEchoState(localEchoStateRef.current);
  }, []);
  const commitParams = useCallback(
    (nextParams: WorkbenchPanelParams): boolean => {
      const committed = canonicalizeWorkbenchPanelParams(
        nextParams,
        pluginsRef.current
      );
      const current = canonicalizeWorkbenchPanelParams(
        authoritativeParamsRef.current,
        pluginsRef.current
      );
      const paramsHash = JSON.stringify(committed);
      if (paramsHash === JSON.stringify(current)) return false;
      authoritativeParamsRef.current = committed;
      applyParamsInMemory(committed);
      const localEchoState = localEchoStateRef.current;
      localEchoState.nextVersion += 1;
      localEchoState.latestVersion = localEchoState.nextVersion;
      localEchoState.versionsByWidgets.set(committed.widgets, {
        paramsHash,
        version: localEchoState.latestVersion,
      });
      apiRef.current.updateParameters(committed);
      return true;
    },
    [applyParamsInMemory]
  );
  const commitUserParams = useCallback(
    (
      reduce: (current: WorkbenchPanelParams) => WorkbenchPanelParams
    ): boolean => {
      const current = canonicalizeWorkbenchPanelParams(
        authoritativeParamsRef.current,
        pluginsRef.current
      );
      return commitParams(reduce(current));
    },
    [commitParams]
  );

  useLayoutEffect(() => {
    observedApiRef.current = api;
    observedParamsRef.current = params;
    observedPluginsRef.current = plugins;
    apiRef.current = api;
    pluginsRef.current = plugins;

    if (replacesFromProps && incoming) {
      authoritativeParamsRef.current = incoming;
      clearLocalEchoes();
      applyParamsInMemory(renderedParams);
      return;
    }
    if (isLocalEcho && marker?.version === echoState.latestVersion) {
      clearLocalEchoes();
    }
    if (pluginsChanged) applyParamsInMemory(renderedParams);
  }, [
    api,
    applyParamsInMemory,
    clearLocalEchoes,
    echoState.latestVersion,
    incoming,
    isLocalEcho,
    marker,
    params,
    plugins,
    pluginsChanged,
    renderedParams,
    replacesFromProps,
  ]);

  useEffect(() => {
    if (highlightId === null) return;
    const timer = setTimeout(() => setHighlightId(null), 1600);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const handleAdd = useCallback(
    (widgetId: string) => {
      const entry = newInstanceEntry(
        widgetId,
        resolveWidgetDeclaration(widgetId, pluginsRef.current)
      );
      const committed = commitUserParams((current) => ({
        ...current,
        widgets: [...current.widgets, entry],
      }));
      if (committed) setHighlightId(entry.id);
    },
    [commitUserParams]
  );
  const handleRemove = useCallback(
    (instanceId: string) => {
      commitUserParams((current) => ({
        ...current,
        widgets: current.widgets.filter((entry) => entry.id !== instanceId),
      }));
    },
    [commitUserParams]
  );
  const handleDuplicate = useCallback(
    (instanceId: string) => {
      const source = optimisticParamsRef.current.widgets.find(
        (entry) => entry.id === instanceId
      );
      if (!source) return;
      const entry: WorkbenchPanelWidgetEntry = {
        h: source.h,
        id: crypto.randomUUID(),
        ...(source.params ? { params: structuredClone(source.params) } : {}),
        w: source.w,
        widgetId: widgetEntryWidgetId(source),
      };
      const committed = commitUserParams((current) => ({
        ...current,
        widgets: [...current.widgets, entry],
      }));
      if (committed) setHighlightId(entry.id);
    },
    [commitUserParams]
  );
  const handleReorder = useCallback(
    (instanceId: string, targetIndex: number) => {
      commitUserParams((current) => ({
        ...current,
        widgets: moveWorkbenchEntry(current.widgets, instanceId, targetIndex),
      }));
    },
    [commitUserParams]
  );
  const handleResize = useCallback(
    (instanceId: string, size: WorkbenchGridSize) => {
      commitUserParams((current) => ({
        ...current,
        widgets: current.widgets.map((entry) => {
          if (entry.id !== instanceId) return entry;
          const declaration = resolveWidgetDeclaration(
            widgetEntryWidgetId(entry),
            pluginsRef.current
          );
          const constrained = clampSize(
            size,
            declaration?.minSize ?? HOST_MIN_WIDGET_SIZE,
            declaration?.maxSize ?? HOST_MAX_WIDGET_SIZE
          );
          return { ...entry, ...constrained };
        }),
      }));
    },
    [commitUserParams]
  );
  const handleUpdateParams = useCallback(
    (instanceId: string, patch: Record<string, JsonValue>) => {
      commitUserParams((current) => ({
        ...current,
        widgets: current.widgets.map((entry) =>
          entry.id === instanceId
            ? {
                ...entry,
                params: { ...(entry.params ?? {}), ...patch },
              }
            : entry
        ),
      }));
    },
    [commitUserParams]
  );
  const refreshOne = useCallback((instanceId: string) => {
    setRefreshTokens((tokens) => ({
      ...tokens,
      [instanceId]: (tokens[instanceId] ?? 0) + 1,
    }));
  }, []);
  const refreshAll = useCallback(() => {
    const instanceIds = optimisticParamsRef.current.widgets.map(
      (entry) => entry.id
    );
    if (instanceIds.length === 0) return;
    setRefreshTokens((tokens) => {
      const next = { ...tokens };
      for (const instanceId of instanceIds) {
        next[instanceId] = (next[instanceId] ?? 0) + 1;
      }
      return next;
    });
    toast.success(i18next.t("workbench.refreshAllSuccess"));
  }, []);

  return {
    handleAdd,
    handleDuplicate,
    handleRemove,
    handleReorder,
    handleResize,
    handleUpdateParams,
    highlightId,
    optimisticParams: renderedParams,
    refreshAll,
    refreshOne,
    refreshTokens,
  };
}
