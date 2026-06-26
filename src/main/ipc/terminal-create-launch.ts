import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import type {
  ResolvedTerminalLaunchOptions,
  TerminalLaunchOptions,
} from "@shared/contracts/terminal-launch.ts";
import { terminalLaunchRegistry } from "../state/terminal-launch-state.ts";
import type { TerminalPanelSession } from "../state/terminal-session-state.ts";

export function nativeLaunchOptions(
  launch: TerminalLaunchOptions | null,
  cwd: string | undefined,
  options: { restoredSession?: boolean } = {}
): ResolvedTerminalLaunchOptions | undefined {
  const nativeLaunch = {
    ...(options.restoredSession
      ? {}
      : {
          ...(launch?.command && { command: launch.command }),
          ...(launch?.env && { env: launch.env }),
        }),
    ...(cwd && { cwd }),
  };
  return Object.keys(nativeLaunch).length > 0 ? nativeLaunch : undefined;
}

export function readCreateLaunch(
  args: CreateTerminalArgs
): ResolvedTerminalLaunchOptions | null {
  return args.launchId ? terminalLaunchRegistry.read(args.launchId) : null;
}

export function resolveCreateTerminalLaunch(
  args: CreateTerminalArgs,
  saved: TerminalPanelSession | null
): {
  context: CreateTerminalArgs["context"];
  nativeLaunch: ResolvedTerminalLaunchOptions | undefined;
} {
  const launch = readCreateLaunch(args);
  const context = saved?.context ?? args.context;
  const cwd = context?.cwd ?? launch?.cwd;
  return {
    context,
    nativeLaunch: nativeLaunchOptions(launch, cwd, {
      restoredSession: Boolean(saved),
    }),
  };
}

export function consumeCreateLaunch(args: CreateTerminalArgs): void {
  if (args.launchId) {
    terminalLaunchRegistry.consume(args.launchId);
  }
}
