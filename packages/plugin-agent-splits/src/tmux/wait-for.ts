import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTmuxValue } from "../main/session-map.ts";
import { flagString } from "./parse.ts";
import type { ParsedTmux } from "./parse-types.ts";
import type { JsonCommand, RunTmuxResult, TmuxRuntime } from "./types.ts";

const CHANNEL_PATTERN = /^[A-Za-z0-9._-]+$/;
const POLL_MS = 25;

type CommandParsed = Extract<ParsedTmux, { kind: "command" }>;

function fail(commands: JsonCommand[], message: string): RunTmuxResult {
  return { commands, exitCode: 1, stderr: `${message}\n`, stdout: "" };
}

function ok(commands: JsonCommand[]): RunTmuxResult {
  return { commands, exitCode: 0, stderr: "", stdout: "" };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function waitChannelPath(workDir: string, channel: string): string {
  return join(workDir, "wait", channel);
}

function resolveChannel(parsed: CommandParsed): string | undefined {
  return flagString(parsed.flags, "-S") ?? parsed.rest[0];
}

function isSignal(parsed: CommandParsed): boolean {
  return parsed.flags["-S"] !== undefined;
}

export async function runWaitFor(
  parsed: CommandParsed,
  runtime: TmuxRuntime,
  commands: JsonCommand[]
): Promise<RunTmuxResult> {
  const tmux = runtime.env.TMUX;
  const session = tmux ? parseTmuxValue(tmux) : null;
  if (!session) {
    return fail(commands, "session environment missing");
  }
  const channel = resolveChannel(parsed);
  if (!channel) {
    return fail(commands, "missing wait channel");
  }
  if (!CHANNEL_PATTERN.test(channel)) {
    return fail(commands, "invalid wait channel");
  }
  const path = waitChannelPath(session.workDir, channel);
  if (isSignal(parsed)) {
    mkdirSync(join(session.workDir, "wait"), { recursive: true });
    writeFileSync(path, "1\n");
    return ok(commands);
  }
  const deadline =
    runtime.waitTimeoutMs === undefined
      ? undefined
      : Date.now() + runtime.waitTimeoutMs;
  const sleep = runtime.sleep ?? defaultSleep;
  while (!existsSync(path)) {
    if (deadline !== undefined && Date.now() >= deadline) {
      return fail(commands, "wait-for timed out");
    }
    await sleep(POLL_MS);
  }
  return ok(commands);
}
