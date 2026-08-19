import { join } from "node:path";
import type {
  LaunchSpawnInput,
  LaunchSpawnResult,
  LaunchWrapInput,
  LaunchWrapResult,
} from "@pier/plugin-api/main";
import {
  bindLeaderSession,
  loadSessionMap,
  paneIdForPanel,
  parseTmuxValue,
} from "./session-map.ts";

const ONE_SHOT_RE = /(^|\s)(-p|--print)(\s|$)/;

export function wrapLaunch(
  input: LaunchWrapInput,
  options: { workDir: string }
): LaunchWrapResult {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return {};
  }
  if (!input.command.trim()) {
    return {};
  }
  if (ONE_SHOT_RE.test(input.command)) {
    return {};
  }
  return {
    decorateSpawn: true,
    pathPrepend: [join(options.workDir, "bin")],
  };
}

export function decorateLaunchSpawn(
  input: LaunchSpawnInput,
  options: { workDir: string }
): LaunchSpawnResult {
  const inherited = input.env.TMUX;
  if (inherited) {
    const parsed = parseTmuxValue(inherited);
    if (parsed) {
      const map = loadSessionMap(parsed.workDir, parsed.sessionId);
      if (map) {
        const paneId =
          paneIdForPanel(map, input.panelId) ?? input.env.TMUX_PANE ?? "%0";
        return {
          env: {
            TMUX: inherited,
            TMUX_PANE: paneId,
          },
        };
      }
    }
  }
  const bound = bindLeaderSession({
    panelId: input.panelId,
    windowId: input.windowId,
    workDir: options.workDir,
  });
  return {
    env: {
      TMUX: bound.tmuxValue,
      TMUX_PANE: "%0",
    },
  };
}
