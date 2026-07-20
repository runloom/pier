import type {
  TerminalCursorStyle,
  TerminalNewCwdPolicy,
} from "@shared/contracts/preferences.ts";
import type { TerminalRuntimeConfig } from "@shared/contracts/terminal.ts";
import { create } from "zustand";

const DEFAULT_TERMINAL_SCROLLBACK_MB = 64;
const MB_BYTES = 1_000_000;

interface TerminalPreferenceSnapshot {
  agentComposerEnabled: boolean;
  terminalCursorBlink: boolean;
  terminalCursorStyle: TerminalCursorStyle;
  terminalNewCwdPolicy: TerminalNewCwdPolicy;
  terminalPasteProtection: boolean;
  terminalScrollbackMb: number;
}

interface TerminalPreferencesState extends TerminalPreferenceSnapshot {
  _hydrate: (snapshot: TerminalPreferenceSnapshot) => void;
  setAgentComposerEnabled: (next: boolean) => Promise<void>;
  setTerminalCursorBlink: (next: boolean) => Promise<void>;
  setTerminalCursorStyle: (next: TerminalCursorStyle) => Promise<void>;
  setTerminalNewCwdPolicy: (next: TerminalNewCwdPolicy) => Promise<void>;
  setTerminalPasteProtection: (next: boolean) => Promise<void>;
  setTerminalScrollbackMb: (next: number) => Promise<void>;
}

function runtimeConfigFrom(
  snapshot: TerminalPreferenceSnapshot
): TerminalRuntimeConfig {
  return {
    cursorStyle: snapshot.terminalCursorStyle,
    cursorBlink: snapshot.terminalCursorBlink,
    scrollbackLimitBytes: snapshot.terminalScrollbackMb * MB_BYTES,
    pasteProtection: snapshot.terminalPasteProtection,
  };
}

function applyRuntimeConfig(snapshot: TerminalPreferenceSnapshot): void {
  try {
    window.pier?.terminal?.setConfig?.(runtimeConfigFrom(snapshot));
  } catch (err) {
    console.error("[terminal-preferences.store] setConfig failed:", err);
  }
}

function normalizeScrollbackMb(value: number): number {
  if (!Number.isFinite(value)) {
    return DEFAULT_TERMINAL_SCROLLBACK_MB;
  }
  return Math.min(512, Math.max(10, Math.trunc(value)));
}

export const useTerminalPreferencesStore = create<TerminalPreferencesState>(
  (set) => ({
    agentComposerEnabled: true,
    terminalCursorStyle: "block",
    terminalCursorBlink: true,
    terminalScrollbackMb: DEFAULT_TERMINAL_SCROLLBACK_MB,
    terminalPasteProtection: true,
    terminalNewCwdPolicy: "activeTerminal",

    _hydrate(snapshot) {
      const next = {
        ...snapshot,
        terminalScrollbackMb: normalizeScrollbackMb(
          snapshot.terminalScrollbackMb
        ),
      };
      applyRuntimeConfig(next);
      set(next);
    },

    async setAgentComposerEnabled(next) {
      try {
        const merged = await window.pier.preferences.update({
          agentComposerEnabled: next,
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setAgentComposerEnabled failed:",
          err
        );
      }
    },

    async setTerminalCursorStyle(next) {
      try {
        const merged = await window.pier.preferences.update({
          terminalCursorStyle: next,
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setTerminalCursorStyle failed:",
          err
        );
      }
    },

    async setTerminalCursorBlink(next) {
      try {
        const merged = await window.pier.preferences.update({
          terminalCursorBlink: next,
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setTerminalCursorBlink failed:",
          err
        );
      }
    },

    async setTerminalScrollbackMb(next) {
      try {
        const merged = await window.pier.preferences.update({
          terminalScrollbackMb: normalizeScrollbackMb(next),
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setTerminalScrollbackMb failed:",
          err
        );
      }
    },

    async setTerminalPasteProtection(next) {
      try {
        const merged = await window.pier.preferences.update({
          terminalPasteProtection: next,
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setTerminalPasteProtection failed:",
          err
        );
      }
    },

    async setTerminalNewCwdPolicy(next) {
      try {
        const merged = await window.pier.preferences.update({
          terminalNewCwdPolicy: next,
        });
        useTerminalPreferencesStore.getState()._hydrate(merged);
      } catch (err) {
        console.error(
          "[terminal-preferences.store] setTerminalNewCwdPolicy failed:",
          err
        );
      }
    },
  })
);

let preferencesListenerAttached = false;
let detachPreferencesListener: (() => void) | null = null;

function attachPreferencesListener(): void {
  if (preferencesListenerAttached || typeof window === "undefined") {
    return;
  }
  const detach = window.pier?.preferences?.onChanged?.((next) => {
    useTerminalPreferencesStore.getState()._hydrate({
      agentComposerEnabled: next.agentComposerEnabled,
      terminalCursorStyle: next.terminalCursorStyle as TerminalCursorStyle,
      terminalCursorBlink: next.terminalCursorBlink,
      terminalScrollbackMb: next.terminalScrollbackMb,
      terminalPasteProtection: next.terminalPasteProtection,
      terminalNewCwdPolicy: next.terminalNewCwdPolicy as TerminalNewCwdPolicy,
    });
  });
  if (!detach) {
    return;
  }
  detachPreferencesListener = detach;
  preferencesListenerAttached = true;
}

export function detachTerminalPreferencesListener(): void {
  detachPreferencesListener?.();
  detachPreferencesListener = null;
  preferencesListenerAttached = false;
}

export async function initTerminalPreferences(): Promise<void> {
  attachPreferencesListener();
  try {
    const snapshot = await window.pier.preferences.read();
    useTerminalPreferencesStore.getState()._hydrate({
      agentComposerEnabled: snapshot.agentComposerEnabled,
      terminalCursorStyle: snapshot.terminalCursorStyle as TerminalCursorStyle,
      terminalCursorBlink: snapshot.terminalCursorBlink,
      terminalScrollbackMb: snapshot.terminalScrollbackMb,
      terminalPasteProtection: snapshot.terminalPasteProtection,
      terminalNewCwdPolicy:
        snapshot.terminalNewCwdPolicy as TerminalNewCwdPolicy,
    });
  } catch (err) {
    console.error(
      "[terminal-preferences.store] init IPC failed; keeping defaults:",
      err
    );
    applyRuntimeConfig(useTerminalPreferencesStore.getState());
  }
}
