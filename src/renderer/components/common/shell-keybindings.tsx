import { useEffect } from "react";
import { useKeyboardShortcuts } from "@/lib/keybindings/use-keybindings.ts";

export function ShellKeybindings(): null {
  useEffect(() => {
    console.log("[pier] ShellKeybindings mounted — keyboard shortcuts active");
  }, []);
  useKeyboardShortcuts();
  return null;
}
