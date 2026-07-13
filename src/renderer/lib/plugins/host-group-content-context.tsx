import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import { createRoot, type Root } from "react-dom/client";

const CONTENT_CONTAINER_SELECTOR = ".dv-content-container";
const CLEANUP_DELAY_MS = 1000;

type AssertDeclaredContribution = (
  entry: PluginRegistryEntry | undefined,
  kind: "groupContent",
  id: string
) => void;

interface GroupContentEntry {
  cleanupTimer: ReturnType<typeof setTimeout> | null;
  disposables: Array<{ dispose: () => void }>;
  host: HTMLDivElement;
  namespace: string;
  owners: Set<symbol>;
  reactRoot: Root;
  visible: (group: PierDockviewGroupHandle) => boolean;
}

const entries = new Map<string, GroupContentEntry>();

function ownerNamespace(entry: PluginRegistryEntry | undefined): string {
  return entry?.manifest.id ?? "host";
}

function entryKey(namespace: string, groupId: string, id: string): string {
  return `${namespace}\u0000${id}\u0000${groupId}`;
}

function contentContainerForGroup(
  group: PierDockviewGroupHandle
): HTMLElement | null {
  const groupElement = group.element ?? group.model?.element;
  if (!(groupElement instanceof HTMLElement)) {
    return null;
  }
  return groupElement.querySelector<HTMLElement>(CONTENT_CONTAINER_SELECTOR);
}

function syncVisibility(
  entry: GroupContentEntry,
  group: PierDockviewGroupHandle
): void {
  const isVisible = entry.visible(group);
  entry.host.style.display = isVisible ? "flex" : "none";
  entry.host.style.visibility = isVisible ? "visible" : "hidden";
  entry.host.style.pointerEvents = isVisible ? "auto" : "none";
}

function disposeEntry(key: string, entry: GroupContentEntry): void {
  if (entry.cleanupTimer) {
    clearTimeout(entry.cleanupTimer);
  }
  for (const disposable of entry.disposables) {
    disposable.dispose();
  }
  entry.reactRoot.unmount();
  entry.host.remove();
  entries.delete(key);
}

export function createHostGroupContentContext(
  entry: PluginRegistryEntry | undefined,
  assertDeclaredContribution: AssertDeclaredContribution
): RendererPluginContext["groupContent"] {
  const namespace = ownerNamespace(entry);
  return {
    claim: ({ group, id, ownerId, render, visible }) => {
      assertDeclaredContribution(entry, "groupContent", id);
      const key = entryKey(namespace, group.id, id);
      const existing = entries.get(key);
      if (existing) {
        existing.owners.add(ownerId);
        if (existing.cleanupTimer) {
          clearTimeout(existing.cleanupTimer);
          existing.cleanupTimer = null;
        }
        syncVisibility(existing, group);
        return true;
      }

      const container = contentContainerForGroup(group);
      if (!container) {
        return false;
      }
      const renderedContent = render();
      if (getComputedStyle(container).position === "static") {
        container.style.position = "relative";
      }

      const host = document.createElement("div");
      host.dataset.pluginId = namespace;
      host.dataset.slot = id;
      host.dataset.groupId = group.id;
      host.style.position = "absolute";
      host.style.inset = "0";
      host.style.zIndex = "1";
      host.style.minHeight = "0";
      host.style.minWidth = "0";
      host.style.display = "flex";
      host.style.flexDirection = "column";
      container.appendChild(host);

      const reactRoot = createRoot(host);
      reactRoot.render(renderedContent);
      const nextEntry: GroupContentEntry = {
        cleanupTimer: null,
        disposables: [],
        host,
        namespace,
        owners: new Set([ownerId]),
        reactRoot,
        visible,
      };
      nextEntry.disposables.push(
        group.api.onDidActivePanelChange(() => syncVisibility(nextEntry, group))
      );
      entries.set(key, nextEntry);
      syncVisibility(nextEntry, group);
      return true;
    },
    release: ({ groupId, id, ownerId }) => {
      assertDeclaredContribution(entry, "groupContent", id);
      const key = entryKey(namespace, groupId, id);
      const current = entries.get(key);
      if (!current) {
        return;
      }
      current.owners.delete(ownerId);
      if (current.owners.size > 0 || current.cleanupTimer) {
        return;
      }
      current.cleanupTimer = setTimeout(() => {
        current.cleanupTimer = null;
        if (current.owners.size === 0) {
          disposeEntry(key, current);
        }
      }, CLEANUP_DELAY_MS);
    },
  };
}

export function clearHostGroupContentForTests(): void {
  for (const [key, entry] of [...entries.entries()]) {
    disposeEntry(key, entry);
  }
}

export function clearHostGroupContentForPlugin(pluginId: string): void {
  for (const [key, entry] of [...entries.entries()]) {
    if (entry.namespace === pluginId) {
      disposeEntry(key, entry);
    }
  }
}
