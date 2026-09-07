import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { promisify } from "node:util";
import { getAgentCatalogEntry } from "@shared/agent-catalog.ts";
import { splitShellCommandWords } from "@shared/agent-command-detection.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  buildResolvedAgentSurfaceCommand,
  extractBareCommandName,
  quoteShellArg,
  resolveUserCommand,
  resolveWrapperShell,
} from "../process-environment/resolve-user-command.ts";

type InitialPromptPlan =
  | { mode: "draft" }
  | { mode: "native-launch"; command: string };
const UNSAFE_OPTIONS = new Set([
  "--",
  "-p",
  "--print",
  "--headless",
  "--no-interactive",
  "--execute",
  "-x",
  "--prompt",
  "--prompt-interactive",
  "--interactive",
  "--message",
  "--input-format",
  "--resume",
  "--continue",
  "--help",
  "-h",
  "--version",
  "--non-interactive",
  "--background",
  "--detach",
  "--output-format",
  "--json",
  "--jsonl",
]);
const VALUE_OPTIONS = new Set([
  "-m",
  "--model",
  "--provider",
  "--profile",
  "--sandbox",
  "--cwd",
  "--directory",
  "--config",
]);

function interactiveCommandWords(
  agentId: AgentKind,
  command: string
): string[] | null {
  if (/[|;&<>(){}$`\n\r\0]/u.test(command)) return null;
  if (!extractBareCommandName(command)) return null;
  const entry = getAgentCatalogEntry(agentId);
  if (!entry) return null;
  const words = splitShellCommandWords(command, 64);
  if (words.length >= 64) return null;
  const prefix = splitShellCommandWords(
    entry.launchCmdByPlatform?.[process.platform] ?? entry.launchCmd,
    16
  );
  if (!(words[0] && prefix[0]) || basename(words[0]) !== prefix[0]) return null;
  if (prefix.slice(1).some((word, index) => words[index + 1] !== word))
    return null;
  for (let index = prefix.length; index < words.length; index++) {
    const word = words[index];
    if (!word || UNSAFE_OPTIONS.has(word.split("=")[0] ?? "")) return null;
    if (!(word.startsWith("-") || VALUE_OPTIONS.has(words[index - 1] ?? "")))
      return null;
  }
  return words;
}

/** Pure final check: unknown help/entry/wrappers keep the task as a draft. */
export function buildInteractiveInitialPrompt(input: {
  agentId: AgentKind;
  command: string;
  text: string;
  help: string;
}): InitialPromptPlan {
  const capability = getAgentCatalogEntry(input.agentId)?.initialPrompt;
  if (
    capability?.mode !== "argv" ||
    !interactiveCommandWords(input.agentId, input.command)
  )
    return { mode: "draft" };
  if (
    input.text.includes("\0") ||
    Buffer.byteLength(input.text, "utf8") > 69_632 ||
    process.platform === "win32"
  )
    return { mode: "draft" };
  if (capability.rejectsAtPrefix && input.text.trimStart().startsWith("@"))
    return { mode: "draft" };
  if (!input.help.toLowerCase().includes(capability.help.toLowerCase()))
    return { mode: "draft" };
  return {
    mode: "native-launch",
    command: `${input.command} ${[...capability.args, input.text].map(quoteShellArg).join(" ")}`,
  };
}

const execFileAsync = promisify(execFile);
const verifiedHelp = new Map<string, Promise<string>>();

export async function resolveInteractiveInitialPrompt(input: {
  agentId: AgentKind;
  command: string;
  text: string;
  cwd?: string | undefined;
  env?: Record<string, string> | undefined;
}): Promise<InitialPromptPlan> {
  const capability = getAgentCatalogEntry(input.agentId)?.initialPrompt;
  const words = interactiveCommandWords(input.agentId, input.command);
  if (capability?.mode !== "argv" || !words?.[0]) return { mode: "draft" };
  try {
    const resolved = await resolveUserCommand({
      commandName: words[0],
      env: input.env,
      cwd: input.cwd,
      pathOnly: true,
    });
    if (resolved.kind !== "absolute") return { mode: "draft" };
    const metadata = await stat(resolved.path);
    const cacheKey = `${resolved.path}:${metadata.mtimeMs}:${metadata.size}:${capability.help}`;
    let pending = verifiedHelp.get(cacheKey);
    if (!pending) {
      pending = execFileAsync(
        resolved.path,
        [...(capability.helpArgs ?? ["--help"])],
        {
          cwd: input.cwd,
          env: input.env ?? process.env,
          timeout: 3000,
          maxBuffer: 256 * 1024,
          windowsHide: true,
        }
      )
        .then((result) => `${result.stdout}\n${result.stderr}`)
        .catch(() => "");
      verifiedHelp.set(cacheKey, pending);
    }
    const plan = buildInteractiveInitialPrompt({
      ...input,
      help: await pending,
    });
    if (plan.mode === "draft") return plan;
    // Execute the exact binary whose interactive syntax was verified. The
    // literal task is appended after parsing the base command, so quoted shell
    // characters in task text cannot turn this into an unowned shell job.
    return {
      mode: "native-launch",
      command: buildResolvedAgentSurfaceCommand({
        commandLine: input.command,
        literalArgs: [...capability.args, input.text],
        env:
          input.env ??
          Object.fromEntries(
            Object.entries(process.env).filter(
              (entry): entry is [string, string] => typeof entry[1] === "string"
            )
          ),
        resolved,
        shell: resolveWrapperShell(input.env),
      }),
    };
  } catch {
    // An unavailable/version-unknown CLI still opens normally with a saved draft.
    return { mode: "draft" };
  }
}
