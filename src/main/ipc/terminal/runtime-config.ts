import type { TerminalRuntimeConfig } from "@shared/contracts/terminal.ts";

function isTerminalCursorStyle(value: unknown): boolean {
  return value === "block" || value === "bar" || value === "underline";
}

export function isTerminalRuntimeConfig(
  value: unknown
): value is TerminalRuntimeConfig {
  if (!value || typeof value !== "object") {
    return false;
  }
  const config = value as Record<string, unknown>;
  return (
    isTerminalCursorStyle(config.cursorStyle) &&
    typeof config.cursorBlink === "boolean" &&
    Number.isFinite(config.scrollbackLimitBytes) &&
    typeof config.pasteProtection === "boolean"
  );
}
