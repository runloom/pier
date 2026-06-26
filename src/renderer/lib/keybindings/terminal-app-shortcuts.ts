import { APP_HANDLED_NATIVE_TERMINAL_COMMANDS } from "@shared/commands.ts";
import { stringifyChord } from "./formatter.ts";
import { keybindingRegistry } from "./registry.ts";

export function terminalAppShortcutKeys(): string[] {
  // Runtime allowlist: include the current effective bindings only for commands
  // declared as app-handled while the native terminal is focused.
  const commandIds = new Set<string>(APP_HANDLED_NATIVE_TERMINAL_COMMANDS);
  const keys = new Set<string>();
  for (const commandId of commandIds) {
    for (const binding of keybindingRegistry.getBindingsFor(commandId)) {
      keys.add(stringifyChord(binding.chord));
    }
  }
  return Array.from(keys).sort();
}
