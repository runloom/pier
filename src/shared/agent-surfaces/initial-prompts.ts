import type { AgentCatalogEntry, AgentKind } from "../contracts/agent.ts";

/** Interactive first-task strategies; no one-shot or shell wrapper inference. */
export const AGENT_INITIAL_PROMPTS: Record<
  AgentKind,
  NonNullable<AgentCatalogEntry["initialPrompt"]>
> = {
  claude: {
    mode: "argv",
    args: ["--"],
    help: "[prompt]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  codex: {
    mode: "argv",
    args: ["--"],
    help: "[PROMPT]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  gemini: {
    mode: "argv",
    args: ["--prompt-interactive"],
    help: "--prompt-interactive",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  aider: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  opencode: {
    mode: "argv",
    args: ["--prompt"],
    help: "--prompt",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  cursor: {
    mode: "argv",
    args: ["--"],
    help: "[prompt...]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  copilot: {
    mode: "argv",
    args: ["--interactive"],
    help: "--interactive",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  droid: {
    mode: "argv",
    args: ["--"],
    help: "[prompt...]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  kimi: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  pi: {
    mode: "argv",
    args: ["--"],
    help: "[messages...]",
    rejectsAtPrefix: true,
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  amp: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  grok: {
    mode: "argv",
    args: ["--"],
    help: "[PROMPT]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  "mimo-code": {
    mode: "argv",
    args: ["--prompt"],
    help: "--prompt",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  ante: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  omp: {
    mode: "argv",
    args: ["--"],
    help: "MESSAGES",
    rejectsAtPrefix: true,
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  antigravity: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  goose: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  kilo: {
    mode: "argv",
    args: ["--prompt"],
    help: "--prompt",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  kiro: {
    mode: "argv",
    args: ["--"],
    help: "[INPUT]",
    helpArgs: ["chat", "--help"],
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  crush: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  aug: {
    mode: "argv",
    args: ["--instruction"],
    help: "--instruction",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  autohand: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  cline: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  codebuff: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  "command-code": {
    mode: "draft",
    evidence:
      "Installed 1.49.1 advertises an initial message, but literal positional argument parsing is not verified. Preserve for manual submission.",
  },
  continue: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  "mistral-vibe": {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  "qwen-code": {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  rovo: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  hermes: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  openclaw: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  devin: {
    mode: "argv",
    args: ["--"],
    help: "<PROMPT>",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  openclaude: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
  codebuddy: {
    mode: "argv",
    args: ["--"],
    help: "[prompt]",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  qodercli: {
    mode: "argv",
    args: ["--prompt-interactive"],
    help: "--prompt-interactive",
    evidence:
      "Interactive entry checked with installed CLI --help (2026-09-07); rechecked for the installed binary before use.",
  },
  fx: {
    mode: "draft",
    evidence:
      "Native interactive initial input not verified; preserve for manual submission. Headless options are not substitutes.",
  },
};
