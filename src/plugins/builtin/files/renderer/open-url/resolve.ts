/**
 * Re-export shared terminal local-path resolve (host + files share one source).
 */
export {
  listTerminalPathResolveRoots,
  normalizeTerminalPathText,
  type ParsedTerminalOpenUrl,
  parseTerminalOpenUrl,
  parseTerminalPathLocation,
  type ResolvedTerminalLocalTargets,
  resolveTerminalLocalPathTargets,
  type TerminalPathLocation,
} from "@shared/terminal-local-path.ts";
