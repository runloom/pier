import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { PierDockviewGroupHandle } from "@shared/contracts/dockview.ts";
import type { PluginRegistryEntry } from "@shared/contracts/plugin.ts";
import type { ReactNode } from "react";
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

function hostNeedsRebuild(
  host: HTMLDivElement,
  container: HTMLElement | null
): boolean {
  if (!host.isConnected) {
    return true;
  }
  if (container && host.parentElement !== container) {
    return true;
  }
  return false;
}

export function createHostGroupContentContext(
  entry: PluginRegistryEntry | undefined,
  assertDeclaredContribution: AssertDeclaredContribution
): RendererPluginContext["groupContent"] {
  const namespace = ownerNamespace(entry);
  return {
    clearAll: () => {
      clearHostGroupContentForPlugin(namespace);
    },
    claim: ({ group, id, ownerId, render, visible }) => {
      assertDeclaredContribution(entry, "groupContent", id);
      const key = entryKey(namespace, group.id, id);
      const existing = entries.get(key);
      const container = contentContainerForGroup(group);

      if (existing) {
        existing.owners.add(ownerId);
        if (existing.cleanupTimer) {
          clearTimeout(existing.cleanupTimer);
          existing.cleanupTimer = null;
        }
        if (!hostNeedsRebuild(existing.host, container)) {
          existing.visible = visible;
          syncVisibility(existing, group);
          return true;
        }
        const owners = new Set(existing.owners);
        disposeEntry(key, existing);
        if (!container) {
          return false;
        }
        return mountNewClaim({
          container,
          group,
          id,
          key,
          namespace,
          owners,
          render,
          visible,
        });
      }

      if (!container) {
        return false;
      }
      // Evaluate render() first so a throw leaves no orphan host DOM.
      // createRoot is outside App — must wrap TooltipProvider (file chrome uses Tooltip).
      return mountNewClaim({
        container,
        group,
        id,
        key,
        namespace,
        owners: new Set([ownerId]),
        render,
        visible,
      });
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

function mountNewClaim(input: {
  container: HTMLElement;
  group: PierDockviewGroupHandle;
  id: string;
  key: string;
  namespace: string;
  owners: Set<symbol>;
  render: () => ReactNode;
  visible: (group: PierDockviewGroupHandle) => boolean;
}): boolean {
  const { container, group, id, key, namespace, owners, render, visible } =
    input;
  // Let render() throw before host is appended so no orphan DOM remains.
  const renderedInner = render();
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
  reactRoot.render(
    <TooltipProvider delayDuration={0} disableHoverableContent>
      {renderedInner}
    </TooltipProvider>
  );
  const nextEntry: GroupContentEntry = {
    cleanupTimer: null,
    disposables: [],
    host,
    namespace,
    owners,
    reactRoot,
    visible,
  };
  nextEntry.disposables.push(
    group.api.onDidActivePanelChange(() => syncVisibility(nextEntry, group))
  );
  entries.set(key, nextEntry);
  syncVisibility(nextEntry, group);
  return true;
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
