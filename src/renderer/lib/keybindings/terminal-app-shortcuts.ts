import { DEFAULT_KEYMAP } from "./defaults.ts";
import { stringifyChord } from "./formatter.ts";
import { keybindingRegistry } from "./registry.ts";

export function terminalAppShortcutKeys(): string[] {
  const commandIds = new Set(
    DEFAULT_KEYMAP.filter((binding) => binding.nativeTerminal === "app").map(
      (binding) => binding.commandId
    )
  );
  const keys = new Set<string>();
  for (const commandId of commandIds) {
    for (const binding of keybindingRegistry.getBindingsFor(commandId)) {
      keys.add(stringifyChord(binding.chord));
    }
  }
  for (const binding of keybindingRegistry.getUserBindings()) {
    if (binding.scope === "global") {
      keys.add(stringifyChord(binding.chord));
    }
  }
  return Array.from(keys).sort();
}
