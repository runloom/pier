import {
  AGENT_START_COMMAND_PREFIX,
  APP_HANDLED_NATIVE_TERMINAL_COMMANDS,
} from "@shared/commands.ts";
import { stringifyChord } from "./formatter.ts";
import { keybindingRegistry } from "./registry.ts";

export function terminalAppShortcutKeys(): string[] {
  // Runtime allowlist: include the current effective bindings only for commands
  // declared as app-handled while the native terminal is focused.
  const commandIds = new Set<string>(APP_HANDLED_NATIVE_TERMINAL_COMMANDS);
  for (const binding of keybindingRegistry.getUserBindings()) {
    if (binding.commandId.startsWith(AGENT_START_COMMAND_PREFIX)) {
      commandIds.add(binding.commandId);
    }
  }
  const keys = new Set<string>();
  for (const commandId of commandIds) {
    for (const binding of keybindingRegistry.getBindingsFor(commandId)) {
      keys.add(stringifyChord(binding.chord));
    }
  }
  return Array.from(keys).sort();
}
