/**
 * Ghostty shell integration still emits OSC 133 C on empty Enter with an
 * empty cmdline. Those must not become shell foreground activity.
 */
export function isBlankShellCommandLine(commandLine: string): boolean {
  return commandLine.trim().length === 0;
}
