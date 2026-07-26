/**
 * Resolve the user-visible keybinding label for a command (or its fallback).
 * Re-renders when the keybinding registry version changes (user remaps).
 */
import { useMemo, useSyncExternalStore } from "react";
import { readVersionedSnapshot } from "@/lib/util/read-versioned-snapshot.ts";
import { formatChord } from "./formatter.ts";
import {
  getKeybindingRegistryVersion,
  keybindingRegistry,
  subscribeKeybindingRegistry,
} from "./registry.ts";

export function useActionKeybindingLabel(
  commandId: string,
  fallbackCommandId?: string
): string | undefined {
  const version = useSyncExternalStore(
    subscribeKeybindingRegistry,
    getKeybindingRegistryVersion,
    () => 0
  );
  return useMemo(
    () =>
      readVersionedSnapshot(version, () => {
        const binding = keybindingRegistry.getFirstBindingFor(
          commandId,
          fallbackCommandId
        );
        return binding ? formatChord(binding.chord) : undefined;
      }),
    [commandId, fallbackCommandId, version]
  );
}
