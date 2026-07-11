import type { RendererPluginPanelRegistration as ExternalPluginPanelRegistration } from "@pier/plugin-api/renderer";
import type { PluginPanelRegistration } from "@plugins/api/renderer.ts";
import type { IDockviewPanelProps } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import i18next from "i18next";
import { KeyRound, type LucideIcon, type LucideProps } from "lucide-react";
import {
  type ComponentProps,
  createElement,
  useEffect,
  useSyncExternalStore,
} from "react";
import { useT } from "@/i18n/use-t.ts";
import { resolvePluginPanelDisplay } from "./display.ts";
import {
  getPluginPanelRegistrations,
  getPluginPanelTitleUpdaterRevision,
  registerPluginPanel,
  updatePluginPanelTitles,
} from "./plugin-panel-registry.ts";
import {
  clearRendererPluginRuntimeDiagnostic,
  getRendererPluginRuntimeDiagnostics,
  reportRendererPluginRuntimeDiagnostic,
  subscribeRendererPluginRuntimeDiagnostics,
} from "./plugin-runtime-diagnostics.ts";

interface SlotSnapshot {
  hasRendererEntry: boolean;
  implementation: ExternalPluginPanelRegistration | null;
  pluginId: string;
}

interface SlotRecord {
  dispose(): void;
  entry: PluginRegistryEntry;
  getSnapshot(): SlotSnapshot;
  listeners: Set<() => void>;
  panelId: string;
  setSnapshot(snapshot: SlotSnapshot): void;
  subscribe(listener: () => void): () => void;
  syncTitle(): void;
}

function getLanguage(): string {
  return i18next.language || "en";
}

function manifestPanelTitle(record: SlotRecord): string {
  const panel = record.entry.manifest.panels.find(
    (item) => item.id === record.panelId
  );
  if (!panel) return record.panelId;
  return resolvePluginPanelDisplay(record.entry.manifest, panel, getLanguage())
    .title;
}

function slotTitle(record: SlotRecord): string {
  const title = record.getSnapshot().implementation?.title;
  if (typeof title === "function") {
    try {
      return title();
    } catch (error) {
      console.error("[external-panel-slot] title resolver failed:", error);
    }
  } else if (title) {
    return title;
  }
  return manifestPanelTitle(record);
}

function ExternalPluginPanelSlotIcon({
  iconProps,
  record,
}: {
  iconProps: LucideProps;
  record: SlotRecord;
}) {
  const snapshot = useSyncExternalStore(
    record.subscribe,
    record.getSnapshot,
    record.getSnapshot
  );
  const Icon = snapshot.implementation?.icon;
  const { size = 14, ...hostProps } = iconProps;
  return (
    <span {...(hostProps as ComponentProps<"span">)}>
      {Icon ? createElement(Icon, { size }) : createElement(KeyRound, { size })}
    </span>
  );
}

function ExternalPluginPanelSlot({
  panelProps,
  record,
}: {
  panelProps: IDockviewPanelProps;
  record: SlotRecord;
}) {
  const t = useT();
  const language = getLanguage();
  const snapshot = useSyncExternalStore(
    record.subscribe,
    record.getSnapshot,
    record.getSnapshot
  );
  const diagnostics = useSyncExternalStore(
    subscribeRendererPluginRuntimeDiagnostics,
    getRendererPluginRuntimeDiagnostics,
    getRendererPluginRuntimeDiagnostics
  );
  useEffect(() => {
    if (language.length > 0) record.syncTitle();
  }, [language, record]);
  if (snapshot.implementation) {
    return createElement(
      snapshot.implementation.component,
      panelProps as unknown as Record<string, unknown>
    );
  }
  const failure = diagnostics.find(
    (item) => item.pluginId === snapshot.pluginId
  );
  const unavailable = failure || !snapshot.hasRendererEntry;
  return (
    <div className="flex h-full items-center justify-center p-6 text-foreground">
      <div className="max-w-md rounded-lg border bg-card p-5">
        <h3 className="font-medium text-sm">
          {t(
            unavailable
              ? "workspace.pluginPanel.unavailableTitle"
              : "workspace.pluginPanel.loadingTitle"
          )}
        </h3>
        <p className="mt-2 text-muted-foreground text-sm leading-6">
          {failure?.message ??
            t(
              snapshot.hasRendererEntry
                ? "workspace.pluginPanel.loadingDescription"
                : "workspace.pluginPanel.missingRendererDescription"
            )}
        </p>
      </div>
    </div>
  );
}

/**
 * 每个外部面板只向 Dockview 注册一次稳定 slot。loading、失败和真实实现都在
 * slot 内切换，因此插件重载和激活回滚不会删除面板实例、分组或位置。
 */
export class ExternalPanelPlaceholderRegistry {
  private readonly records = new Map<string, SlotRecord>();
  private readonly conflictDiagnostics = new Map<string, string>();

  dispose(): void {
    for (const record of this.records.values()) record.dispose();
    this.records.clear();
    for (const [pluginId, message] of this.conflictDiagnostics) {
      this.clearConflictDiagnostic(pluginId, message);
    }
    this.conflictDiagnostics.clear();
  }

  registerImplementation(
    entry: PluginRegistryEntry,
    implementation: ExternalPluginPanelRegistration
  ): () => void {
    const record = this.records.get(implementation.id);
    if (!record || record.entry.manifest.id !== entry.manifest.id) {
      throw new Error(
        `external panel slot is not available: ${entry.manifest.id}:${implementation.id}`
      );
    }
    record.setSnapshot({ ...record.getSnapshot(), implementation });
    return () => {
      if (record.getSnapshot().implementation === implementation) {
        record.setSnapshot({ ...record.getSnapshot(), implementation: null });
      }
    };
  }

  unresolvedPanelIds(entry: PluginRegistryEntry): readonly string[] {
    return entry.manifest.panels
      .filter((panel) => {
        const record = this.records.get(panel.id);
        return (
          record?.entry.manifest.id !== entry.manifest.id ||
          record.getSnapshot().implementation == null
        );
      })
      .map((panel) => panel.id);
  }

  sync(entries: ReadonlyMap<string, PluginRegistryEntry>): void {
    const desiredPanelIds = new Set<string>();
    const nextConflicts = new Map<string, string>();
    for (const entry of entries.values()) {
      if (entry.runtime.kind !== "external") continue;
      for (const panel of entry.manifest.panels) {
        if (!panel.id.startsWith(`${entry.manifest.id}.`)) {
          this.recordConflict(
            nextConflicts,
            entry.manifest.id,
            `external panel id must use the plugin namespace: ${panel.id}`
          );
          continue;
        }
        const existingRecord = this.records.get(panel.id);
        if (existingRecord) {
          if (existingRecord.entry.manifest.id !== entry.manifest.id) {
            this.recordConflict(
              nextConflicts,
              entry.manifest.id,
              `external panel id is owned by another plugin: ${panel.id}`
            );
            continue;
          }
          desiredPanelIds.add(panel.id);
          existingRecord.entry = entry;
          existingRecord.setSnapshot({
            ...existingRecord.getSnapshot(),
            hasRendererEntry: Boolean(entry.runtime.rendererEntryUrl),
            pluginId: entry.manifest.id,
          });
          existingRecord.syncTitle();
          continue;
        }
        if (getPluginPanelRegistrations().has(panel.id)) {
          this.recordConflict(
            nextConflicts,
            entry.manifest.id,
            `external panel id is already registered: ${panel.id}`
          );
          continue;
        }
        desiredPanelIds.add(panel.id);
        this.createSlot(entry, panel.id);
      }
    }
    for (const [panelId, record] of this.records) {
      if (desiredPanelIds.has(panelId)) continue;
      record.dispose();
      this.records.delete(panelId);
    }
    for (const [pluginId, message] of this.conflictDiagnostics) {
      if (!nextConflicts.has(pluginId)) {
        this.clearConflictDiagnostic(pluginId, message);
      }
    }
    this.conflictDiagnostics.clear();
    for (const [pluginId, message] of nextConflicts) {
      this.conflictDiagnostics.set(pluginId, message);
    }
  }

  private createSlot(entry: PluginRegistryEntry, panelId: string): void {
    const listeners = new Set<() => void>();
    let snapshot: SlotSnapshot = {
      hasRendererEntry: Boolean(entry.runtime.rendererEntryUrl),
      implementation: null,
      pluginId: entry.manifest.id,
    };
    let lastPublishedTitle: string | null = null;
    let lastTitleUpdaterRevision: number | null = null;
    const record: SlotRecord = {
      dispose: () => undefined,
      entry,
      getSnapshot: () => snapshot,
      listeners,
      panelId,
      setSnapshot: (next: SlotSnapshot) => {
        if (
          snapshot.hasRendererEntry === next.hasRendererEntry &&
          snapshot.implementation === next.implementation &&
          snapshot.pluginId === next.pluginId
        ) {
          return;
        }
        snapshot = next;
        for (const listener of listeners) listener();
        record.syncTitle();
      },
      subscribe: (listener: () => void) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      syncTitle: () => {
        const nextTitle = slotTitle(record);
        const updaterRevision = getPluginPanelTitleUpdaterRevision();
        if (
          updaterRevision === null ||
          (nextTitle === lastPublishedTitle &&
            updaterRevision === lastTitleUpdaterRevision)
        ) {
          return;
        }
        if (updatePluginPanelTitles(panelId, nextTitle)) {
          lastPublishedTitle = nextTitle;
          lastTitleUpdaterRevision = updaterRevision;
        }
      },
    };
    const panel = entry.manifest.panels.find((item) => item.id === panelId);
    if (!panel) throw new Error(`external panel is not declared: ${panelId}`);
    const registration: PluginPanelRegistration = {
      component: (props) => (
        <ExternalPluginPanelSlot panelProps={props} record={record} />
      ),
      icon: ((props: LucideProps) => (
        <ExternalPluginPanelSlotIcon iconProps={props} record={record} />
      )) as LucideIcon,
      id: panelId,
      kind: "web",
      title: () => slotTitle(record),
    };
    record.dispose = registerPluginPanel(registration);
    this.records.set(panelId, record);
  }

  private clearConflictDiagnostic(pluginId: string, message: string): void {
    if (
      getRendererPluginRuntimeDiagnostics().find(
        (item) => item.pluginId === pluginId
      )?.message === message
    ) {
      clearRendererPluginRuntimeDiagnostic(pluginId);
    }
  }

  private recordConflict(
    conflicts: Map<string, string>,
    pluginId: string,
    message: string
  ): void {
    conflicts.set(pluginId, message);
    reportRendererPluginRuntimeDiagnostic({ message, pluginId });
  }
}
