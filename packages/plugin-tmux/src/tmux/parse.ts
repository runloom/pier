import type { ParsedTmux } from "./parse-types.ts";

export type { ParsedTmux } from "./parse-types.ts";

const VERB_ALIASES: Record<string, string> = {
  capturep: "capture-pane",
  display: "display-message",
  has: "has-session",
  killp: "kill-pane",
  killw: "kill-window",
  ls: "list-sessions",
  lsp: "list-panes",
  lsw: "list-windows",
  new: "new-session",
  neww: "new-window",
  renamew: "rename-window",
  respawnp: "respawn-pane",
  resizep: "resize-pane",
  selectl: "select-layout",
  selectp: "select-pane",
  selectw: "select-window",
  send: "send-keys",
  set: "set-option",
  setw: "set-window-option",
  splitw: "split-window",
  wait: "wait-for",
};

export function canonicalTmuxVerb(verb: string): string {
  return VERB_ALIASES[verb] ?? verb;
}

const GLOBAL_VALUE_FLAGS = new Set(["-c", "-f", "-L", "-S", "-T"]);
const GLOBAL_BOOL_FLAGS = new Set(["-2", "-C", "-D", "-l", "-u", "-v"]);
const DEFAULT_VALUE_FLAGS = new Set(["-t"]);
const VERB_VALUE_FLAGS: Record<string, ReadonlySet<string>> = {
  "capture-pane": new Set(["-b", "-E", "-S", "-t"]),
  "display-message": new Set(["-c", "-F", "-t"]),
  "kill-pane": DEFAULT_VALUE_FLAGS,
  "kill-window": DEFAULT_VALUE_FLAGS,
  "list-panes": new Set(["-F", "-f", "-t"]),
  "list-windows": new Set(["-F", "-f", "-t"]),
  "new-session": new Set(["-c", "-e", "-F", "-n", "-s", "-t"]),
  "new-window": new Set(["-c", "-e", "-F", "-n", "-t"]),
  "rename-window": DEFAULT_VALUE_FLAGS,
  "resize-pane": new Set(["-t", "-x", "-y"]),
  "respawn-pane": new Set(["-c", "-e", "-t"]),
  "select-layout": DEFAULT_VALUE_FLAGS,
  "select-pane": new Set(["-T", "-t"]),
  "select-window": DEFAULT_VALUE_FLAGS,
  "send-keys": new Set(["-N", "-t"]),
  "set-option": new Set(["-o", "-t"]),
  "set-window-option": DEFAULT_VALUE_FLAGS,
  "split-window": new Set(["-c", "-e", "-F", "-l", "-t"]),
  "wait-for": new Set(),
};
const REPEATABLE_VALUE_FLAGS = new Set(["-e"]);

function valueFlagsForVerb(verb: string): ReadonlySet<string> {
  return VERB_VALUE_FLAGS[verb] ?? DEFAULT_VALUE_FLAGS;
}

const PERCENT_RE = /^(\d+(?:\.\d+)?)%$/;

function assignValueFlag(
  flags: Record<string, string | true>,
  name: string,
  value: string
): void {
  if (REPEATABLE_VALUE_FLAGS.has(name) && typeof flags[name] === "string") {
    flags[name] = `${flags[name]}\n${value}`;
    return;
  }
  flags[name] = value;
}

export function parsePercentRatio(raw: string | undefined): number | undefined {
  if (!raw) {
    return;
  }
  const match = PERCENT_RE.exec(raw);
  if (!match?.[1]) {
    return;
  }
  const ratio = Number(match[1]) / 100;
  if (!(ratio > 0 && ratio < 1)) {
    return;
  }
  return ratio;
}

export function flagString(
  flags: Record<string, string | true>,
  name: string
): string | undefined {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

export function flagOn(
  flags: Record<string, string | true>,
  name: string
): boolean {
  return flags[name] === true;
}

export function parseTmuxArgv(argv: string[]): ParsedTmux {
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "-V" || arg === "-version" || arg === "--version") {
      return { kind: "version" };
    }
    if (arg === "--") {
      i += 1;
      break;
    }
    if (!arg.startsWith("-")) {
      break;
    }
    if (GLOBAL_VALUE_FLAGS.has(arg)) {
      i += 2;
      continue;
    }
    if (
      GLOBAL_BOOL_FLAGS.has(arg) ||
      (arg.startsWith("-") && arg.length === 2 && !arg.startsWith("--"))
    ) {
      i += 1;
      continue;
    }
    if (arg.startsWith("-") && arg.length > 2 && !arg.startsWith("--")) {
      if (arg.includes("V")) {
        return { kind: "version" };
      }
      i += 1;
      continue;
    }
    i += 1;
  }
  const verb = argv[i];
  if (!verb) {
    return { kind: "error", exitCode: 1, message: "no command" };
  }
  if (verb === "version") {
    return { kind: "version" };
  }
  return parseCommandArgs(verb, argv.slice(i + 1));
}

function parseCommandArgs(rawVerb: string, args: string[]): ParsedTmux {
  const verb = canonicalTmuxVerb(rawVerb);
  const valueFlags = valueFlagsForVerb(verb);
  const flags: Record<string, string | true> = {};
  const rest: string[] = [];
  let i = 0;
  while (i < args.length) {
    const arg = args[i];
    if (arg === undefined) {
      break;
    }
    if (arg === "--") {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (!arg.startsWith("-") || arg === "-") {
      rest.push(...args.slice(i));
      break;
    }
    if (
      arg.startsWith("-") &&
      !arg.startsWith("--") &&
      arg.length > 2 &&
      !valueFlags.has(arg)
    ) {
      let cluster = arg.slice(1);
      let consumedNext = false;
      while (cluster.length > 0) {
        const ch = cluster[0];
        cluster = cluster.slice(1);
        if (ch === undefined) {
          break;
        }
        const name = `-${ch}`;
        if (valueFlags.has(name)) {
          if (cluster.length > 0) {
            assignValueFlag(flags, name, cluster);
            break;
          }
          const value = args[i + 1];
          if (value === undefined) {
            return {
              kind: "error",
              exitCode: 1,
              message: `missing value for ${name}`,
            };
          }
          assignValueFlag(flags, name, value);
          consumedNext = true;
          break;
        }
        flags[name] = true;
      }
      i += consumedNext ? 2 : 1;
      continue;
    }
    if (valueFlags.has(arg)) {
      const value = args[i + 1];
      if (value === undefined) {
        return {
          kind: "error",
          exitCode: 1,
          message: `missing value for ${arg}`,
        };
      }
      assignValueFlag(flags, arg, value);
      i += 2;
      continue;
    }
    flags[arg] = true;
    i += 1;
  }
  return { kind: "command", flags, rest, verb };
}

export function parsePaneTarget(
  raw: string | undefined,
  fallback: string | undefined
): string | undefined {
  const source = raw ?? fallback;
  if (!source) {
    return;
  }
  const match = /(%\d+)/.exec(source);
  return match?.[1] ?? source;
}
