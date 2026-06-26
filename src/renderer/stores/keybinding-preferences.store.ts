import type { UserKeymapEntry } from "@shared/contracts/preferences.ts";
import { create } from "zustand";
import { DEFAULT_KEYMAP } from "@/lib/keybindings/defaults.ts";
import { stringifyChord } from "@/lib/keybindings/formatter.ts";
import { isMac } from "@/lib/keybindings/matcher.ts";
import { parseChord } from "@/lib/keybindings/parse.ts";
import { keybindingRegistry } from "@/lib/keybindings/registry.ts";
import { terminalAppShortcutKeys } from "@/lib/keybindings/terminal-app-shortcuts.ts";
import type { KeybindingScope, KeyChord } from "@/lib/keybindings/types.ts";

interface KeybindingUpdateResult {
  error?: string;
  ok: boolean;
}

interface KeybindingPreferencesState {
  cancelRecording: () => void;
  clearBinding: (commandId: string) => Promise<KeybindingUpdateResult>;
  error: string | null;
  hasUserEntry: (commandId: string) => boolean;
  recordingCommandId: string | null;
  resetAllBindings: () => Promise<KeybindingUpdateResult>;
  resetBinding: (commandId: string) => Promise<KeybindingUpdateResult>;
  setBinding: (
    commandId: string,
    keys: string,
    scope?: KeybindingScope
  ) => Promise<KeybindingUpdateResult>;
  startRecording: (commandId: string) => void;
  userKeymap: UserKeymapEntry[];
}

function hasDefaultBinding(commandId: string): boolean {
  return DEFAULT_KEYMAP.some((binding) => binding.commandId === commandId);
}

function entriesWithoutCommand(
  entries: readonly UserKeymapEntry[],
  commandId: string
): UserKeymapEntry[] {
  const unbindId = `-${commandId}`;
  return entries.filter(
    (entry) => entry.commandId !== commandId && entry.commandId !== unbindId
  );
}

function applyUserKeymap(entries: readonly UserKeymapEntry[]): void {
  keybindingRegistry.loadUserKeymap(
    entries.map((entry) => ({
      ...entry,
      scope: entry.scope as KeybindingScope,
    }))
  );
  try {
    window.pier?.terminal?.setAppShortcutKeys?.(terminalAppShortcutKeys());
  } catch (err) {
    console.error(
      "[keybinding-preferences.store] setAppShortcutKeys failed:",
      err
    );
  }
}

async function persistUserKeymap(
  entries: UserKeymapEntry[]
): Promise<KeybindingUpdateResult> {
  try {
    await window.pier.preferences.update({ userKeymap: entries });
    applyUserKeymap(entries);
    useKeybindingPreferencesStore.setState({
      error: null,
      recordingCommandId: null,
      userKeymap: entries,
    });
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    useKeybindingPreferencesStore.setState({ error: message });
    return { ok: false, error: message };
  }
}

export const useKeybindingPreferencesStore = create<KeybindingPreferencesState>(
  (set, get) => ({
    error: null,
    recordingCommandId: null,
    userKeymap: [],

    cancelRecording() {
      set({ error: null, recordingCommandId: null });
    },

    clearBinding(commandId) {
      const next: UserKeymapEntry[] = [
        ...entriesWithoutCommand(get().userKeymap, commandId),
        { commandId: `-${commandId}`, keys: "", scope: "global" },
      ];
      return persistUserKeymap(next);
    },

    hasUserEntry(commandId) {
      const unbindId = `-${commandId}`;
      return get().userKeymap.some(
        (entry) => entry.commandId === commandId || entry.commandId === unbindId
      );
    },

    resetBinding(commandId) {
      return persistUserKeymap(
        entriesWithoutCommand(get().userKeymap, commandId)
      );
    },

    resetAllBindings() {
      return persistUserKeymap([]);
    },

    setBinding(commandId, keys, scope = "global") {
      let chord: KeyChord;
      try {
        chord = parseChord(keys, isMac());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
        return Promise.resolve({ ok: false, error: message });
      }
      const normalizedKeys = stringifyChord(chord);
      const conflict = keybindingRegistry.findConflict(chord, scope, commandId);
      if (conflict) {
        const message = `Shortcut already used by ${conflict.commandId}`;
        set({ error: message });
        return Promise.resolve({ ok: false, error: message });
      }
      const next: UserKeymapEntry[] = [
        ...entriesWithoutCommand(get().userKeymap, commandId),
      ];
      if (hasDefaultBinding(commandId)) {
        next.push({ commandId: `-${commandId}`, keys: "", scope: "global" });
      }
      next.push({ commandId, keys: normalizedKeys, scope });
      return persistUserKeymap(next);
    },

    startRecording(commandId) {
      set({ error: null, recordingCommandId: commandId });
    },
  })
);

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function hydrate(entries: readonly UserKeymapEntry[]): void {
  const next = [...entries];
  applyUserKeymap(next);
  useKeybindingPreferencesStore.setState({
    error: null,
    recordingCommandId: null,
    userKeymap: next,
  });
}

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    hydrate(next.userKeymap ?? []);
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachKeybindingPreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initKeybindingPreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    hydrate(snapshot.userKeymap ?? []);
  } catch (err) {
    console.error(
      "[keybinding-preferences.store] init IPC failed; keeping defaults:",
      err
    );
    hydrate([]);
  }
}
