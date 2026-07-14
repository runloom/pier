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

const LEGACY_COMMAND_IDS: Record<string, string> = {
  "pier.panel.newMissionControl": "pier.panel.newWorkbench",
  "pier.terminal.toggleDebugOverlay": "pier.terminal.openDebugWindow",
};

function normalizeCommandId(commandId: string): string {
  const isUnbind = commandId.startsWith("-");
  const rawCommandId = isUnbind ? commandId.slice(1) : commandId;
  const normalizedCommandId = LEGACY_COMMAND_IDS[rawCommandId] ?? rawCommandId;
  return isUnbind ? `-${normalizedCommandId}` : normalizedCommandId;
}

function normalizeTargetCommandId(commandId: string): string {
  const normalizedCommandId = normalizeCommandId(commandId);
  return normalizedCommandId.startsWith("-")
    ? normalizedCommandId.slice(1)
    : normalizedCommandId;
}

function normalizeUserKeymapEntries(
  entries: readonly UserKeymapEntry[]
): UserKeymapEntry[] {
  return entries.map((entry) => ({
    ...entry,
    commandId: normalizeCommandId(entry.commandId),
  }));
}

function equalUserKeymapEntries(
  left: readonly UserKeymapEntry[],
  right: readonly UserKeymapEntry[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  return left.every((entry, index) => {
    const other = right[index];
    return (
      other !== undefined &&
      entry.commandId === other.commandId &&
      entry.keys === other.keys &&
      entry.scope === other.scope
    );
  });
}

function hasDefaultBinding(commandId: string): boolean {
  const normalizedCommandId = normalizeTargetCommandId(commandId);
  return DEFAULT_KEYMAP.some(
    (binding) => binding.commandId === normalizedCommandId
  );
}

function entriesWithoutCommand(
  entries: readonly UserKeymapEntry[],
  commandId: string
): UserKeymapEntry[] {
  const normalizedCommandId = normalizeTargetCommandId(commandId);
  const unbindId = `-${normalizedCommandId}`;
  return normalizeUserKeymapEntries(entries).filter(
    (entry) =>
      entry.commandId !== normalizedCommandId && entry.commandId !== unbindId
  );
}

function applyUserKeymap(entries: readonly UserKeymapEntry[]): void {
  const normalizedEntries = normalizeUserKeymapEntries(entries);
  keybindingRegistry.loadUserKeymap(
    normalizedEntries.map((entry) => ({
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
  const normalizedEntries = normalizeUserKeymapEntries(entries);
  try {
    await window.pier.preferences.update({ userKeymap: normalizedEntries });
    applyUserKeymap(normalizedEntries);
    useKeybindingPreferencesStore.setState({
      error: null,
      recordingCommandId: null,
      userKeymap: normalizedEntries,
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
      const normalizedCommandId = normalizeTargetCommandId(commandId);
      const next: UserKeymapEntry[] = [
        ...entriesWithoutCommand(get().userKeymap, normalizedCommandId),
        { commandId: `-${normalizedCommandId}`, keys: "", scope: "global" },
      ];
      return persistUserKeymap(next);
    },

    hasUserEntry(commandId) {
      const normalizedCommandId = normalizeTargetCommandId(commandId);
      const unbindId = `-${normalizedCommandId}`;
      return get().userKeymap.some(
        (entry) =>
          entry.commandId === normalizedCommandId ||
          entry.commandId === unbindId
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
      const normalizedCommandId = normalizeTargetCommandId(commandId);
      let chord: KeyChord;
      try {
        chord = parseChord(keys, isMac());
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        set({ error: message });
        return Promise.resolve({ ok: false, error: message });
      }
      const normalizedKeys = stringifyChord(chord);
      const conflict = keybindingRegistry.findConflict(
        chord,
        scope,
        normalizedCommandId
      );
      if (conflict) {
        const message = `Shortcut already used by ${conflict.commandId}`;
        set({ error: message });
        return Promise.resolve({ ok: false, error: message });
      }
      const next: UserKeymapEntry[] = [
        ...entriesWithoutCommand(get().userKeymap, normalizedCommandId),
      ];
      if (hasDefaultBinding(normalizedCommandId)) {
        next.push({
          commandId: `-${normalizedCommandId}`,
          keys: "",
          scope: "global",
        });
      }
      next.push({
        commandId: normalizedCommandId,
        keys: normalizedKeys,
        scope,
      });
      return persistUserKeymap(next);
    },

    startRecording(commandId) {
      set({
        error: null,
        recordingCommandId: normalizeTargetCommandId(commandId),
      });
    },
  })
);

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;
let didHydrateKeybindings = false;

function hydrate(entries: readonly UserKeymapEntry[]): void {
  const next = normalizeUserKeymapEntries(entries);
  if (
    didHydrateKeybindings &&
    equalUserKeymapEntries(
      useKeybindingPreferencesStore.getState().userKeymap,
      next
    )
  ) {
    return;
  }
  didHydrateKeybindings = true;
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
  didHydrateKeybindings = false;
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
