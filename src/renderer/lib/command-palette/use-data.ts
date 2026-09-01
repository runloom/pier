import { useMemo, useSyncExternalStore } from "react";
import {
  actionRegistry,
  getActionRegistryVersion,
  subscribeActionRegistry,
} from "@/lib/actions/registry.ts";
import { resolveActionShortcutChord } from "@/lib/actions/shortcut-hint.ts";
import type { Action } from "@/lib/actions/types.ts";
import { formatChord } from "@/lib/keybindings/formatter.ts";
import {
  getKeybindingRegistryVersion,
  subscribeKeybindingRegistry,
} from "@/lib/keybindings/registry.ts";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";

export function useCommandPaletteActions(): readonly Action[] {
  const version = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(version, () =>
        actionRegistry.list("command-palette")
      ),
    [version]
  );
}

/**
 * 反查每个 actionId 当前生效的 keybinding 文案. 订阅两个 registry 的 version
 * 触发重渲；只有任一 registry 版本变化时才重建映射。
 */
export function useCommandPaletteKeybindingLabels(): ReadonlyMap<
  string,
  string
> {
  const actionVersion = useSyncExternalStore(
    subscribeActionRegistry,
    getActionRegistryVersion,
    () => 0
  );
  const keybindingVersion = useSyncExternalStore(
    subscribeKeybindingRegistry,
    getKeybindingRegistryVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(actionVersion + keybindingVersion, () => {
        const map = new Map<string, string>();
        for (const action of actionRegistry.list("command-palette")) {
          const chord = resolveActionShortcutChord(action);
          if (chord) {
            map.set(action.id, formatChord(chord));
          }
        }
        return map;
      }),
    [actionVersion, keybindingVersion]
  );
}
