import { useKeyboardShortcuts } from "@/lib/keybindings/use-registry.ts";

export function ShellKeybindings(): null {
  useKeyboardShortcuts();
  return null;
}
