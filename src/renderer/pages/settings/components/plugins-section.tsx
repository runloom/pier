import { Card, CardContent } from "@pier/ui/card.tsx";
import { StatusStack } from "@pier/ui/status-stack.tsx";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { useState, useSyncExternalStore } from "react";
import { useT } from "@/i18n/use-t.ts";
import {
  getRendererPluginRuntimeDiagnostics,
  subscribeRendererPluginRuntimeDiagnostics,
} from "@/lib/plugins/plugin-runtime-diagnostics.ts";
import { usePluginRegistryStore } from "@/stores/plugin-registry.store.ts";
import { ManagedPluginsSection } from "./managed-plugins-section.tsx";
import { buildPluginStatusItems } from "./plugin-status-items.ts";

export function PluginsSection() {
  const t = useT();
  const plugins = usePluginRegistryStore((state) => state.plugins);
  const diagnostics = usePluginRegistryStore((state) => state.diagnostics);
  const runtimeDiagnostics = useSyncExternalStore(
    subscribeRendererPluginRuntimeDiagnostics,
    getRendererPluginRuntimeDiagnostics,
    getRendererPluginRuntimeDiagnostics
  );
  const initialized = usePluginRegistryStore((state) => state.initialized);
  const storeError = usePluginRegistryStore((state) => state.error);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [catalogStatus, setCatalogStatus] = useState<{
    pluginMode: "workspace" | "release";
    catalogError: string | null;
  }>({ pluginMode: "release", catalogError: null });

  const togglePlugin = (entry: PluginRegistryEntry) => {
    setPendingId(entry.manifest.id);
    setToggleError(null);
    const request = entry.enabled
      ? window.pier.plugins.disable(entry.manifest.id)
      : window.pier.plugins.enable(entry.manifest.id);
    request
      // PLUGINS_CHANGED 广播会同步所有窗口(含本窗口); 这里在 resolve 路径
      // 再显式 refresh 一次, 让发起窗口不依赖广播到达时序, 与 preferences
      // 的"发起端确定性更新"约定一致。runtime 刷新由 bootstrap 的 store
      // 订阅按运行态集合去重, 不会重复 reactivate。
      .then(() => usePluginRegistryStore.getState().refresh())
      .catch((err: unknown) => {
        setToggleError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        setPendingId(null);
      });
  };

  const error = toggleError ?? storeError;
  const items = buildPluginStatusItems({
    pageError: error,
    catalogError: catalogStatus.catalogError,
    diagnostics,
    runtimeDiagnostics,
    pluginMode: catalogStatus.pluginMode,
    t,
  });

  return (
    <div className="px-4 pb-4" id="plugins">
      <h1 className="mb-4 text-xl">{t("settings.section.plugins")}</h1>
      <Card>
        <CardContent className="flex flex-col gap-3 px-0">
          {items.length > 0 ? (
            <div className="px-(--card-spacing)">
              <StatusStack data-testid="plugins-status-stack" items={items} />
            </div>
          ) : null}
          <ManagedPluginsSection
            builtinEntries={plugins}
            builtinInitialized={initialized}
            onCatalogStatusChange={setCatalogStatus}
            onToggleBuiltin={togglePlugin}
            pendingBuiltinId={pendingId}
          />
        </CardContent>
      </Card>
    </div>
  );
}
