import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import {
  applyEdits,
  type FormattingOptions,
  modify,
  type ParseError,
  parse,
} from "jsonc-parser";
import {
  atomicWriteFile,
  commandExistsOnPath,
  type NestedJsonIntegrationSpec,
  pierHookCommandV3WithStdin,
  preflightPierNestedHooksInstall,
  transformPierHooksUnlessNewer,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const devinConfigPath = () =>
  join(homedir(), ".config", "devin", "config.json");

function devinCommand(
  agentId: AgentKind,
  nativeEvent: string,
  event:
    | "SessionStart"
    | "PromptSubmit"
    | "Stop"
    | "processing"
    | "SessionEnd"
    | "ToolStart"
    | "ToolComplete"
): string {
  return pierHookCommandV3WithStdin({
    agentId,
    event,
    nativeEvent,
    turnIdFields: ["prompt_id"],
  });
}

/**
 * Devin hook 事件 → pier 事件名。
 * 全部不写 matcher：Devin 把 matcher 当正则，Claude 惯用的 "*" 是非法
 * 正则，写了会导致 hook 注册失败。
 */
const DEVIN_SPEC: NestedJsonIntegrationSpec = {
  agentId: "devin",
  runtime: { stopAuthority: "advisory" },
  configPath: devinConfigPath,
  events: [
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "SessionStart", "SessionStart"),
      nativeEvent: "SessionStart",
      pierEvent: "SessionStart",
    },
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "UserPromptSubmit", "PromptSubmit"),
      nativeEvent: "UserPromptSubmit",
      pierEvent: "PromptSubmit",
    },
    {
      buildCommand: (agentId) => devinCommand(agentId, "Stop", "Stop"),
      nativeEvent: "Stop",
      pierEvent: "Stop",
    },
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "PostCompaction", "processing"),
      nativeEvent: "PostCompaction",
      pierEvent: "processing",
    },
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "SessionEnd", "SessionEnd"),
      nativeEvent: "SessionEnd",
      pierEvent: "SessionEnd",
    },
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "PreToolUse", "ToolStart"),
      nativeEvent: "PreToolUse",
      pierEvent: "ToolStart",
    },
    {
      buildCommand: (agentId) =>
        devinCommand(agentId, "PostToolUse", "ToolComplete"),
      nativeEvent: "PostToolUse",
      pierEvent: "ToolComplete",
    },
  ],
};

export const DEVIN_HOOK_EVENTS = DEVIN_SPEC.events;

/** 消费字符串字面量（起始引号已确认），返回消费后的输出片段与新下标。 */
function consumeStringLiteral(
  input: string,
  start: number
): { next: number; text: string } {
  const len = input.length;
  let out = input.charAt(start);
  let i = start + 1;
  while (i < len) {
    const ch = input.charAt(i);
    out += ch;
    if (ch === "\\" && i + 1 < len) {
      out += input.charAt(i + 1);
      i += 2;
      continue;
    }
    i++;
    if (ch === '"') {
      break;
    }
  }
  return { next: i, text: out };
}

/** 跳过行注释（`//`...行尾），换行符本身不吃, 维持行号。 */
function skipLineComment(input: string, start: number): number {
  const len = input.length;
  let i = start;
  while (i < len && input.charAt(i) !== "\n") {
    i++;
  }
  return i;
}

/** 跳过块注释（`/* *\/`), 内容替换为空格/换行以维持行号/列号。 */
function skipBlockComment(
  input: string,
  start: number
): { next: number; text: string } {
  const len = input.length;
  let out = "";
  let i = start + 2;
  while (i < len && !(input.charAt(i) === "*" && input.charAt(i + 1) === "/")) {
    out += input.charAt(i) === "\n" ? "\n" : " ";
    i++;
  }
  return { next: i + 2, text: out };
}

/**
 * 剥离 JSONC 注释（`//` 行注释与 `/* *\/` 块注释），逐字符扫描，忽略
 * 字符串字面量内的注释起始序列（含转义处理，避免 `"a \" // b"` 之类
 * 提前误判字符串已结束）。输出仍是合法 JSON 文本（注释位置用等长空白
 * 占位，保持行号/列号不变，便于报错定位；不追求还原注释本身）。
 *
 * 该函数只用于兼容测试和诊断；安装写回使用 jsonc-parser 的局部编辑，
 * 不会借由剥注释后的对象重写整个用户文件。
 */
export function stripJsonComments(input: string): string {
  let out = "";
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input.charAt(i);
    const next = input.charAt(i + 1);

    if (ch === '"') {
      const consumed = consumeStringLiteral(input, i);
      out += consumed.text;
      i = consumed.next;
      continue;
    }

    if (ch === "/" && next === "/") {
      i = skipLineComment(input, i);
      continue;
    }

    if (ch === "/" && next === "*") {
      const consumed = skipBlockComment(input, i);
      out += consumed.text;
      i = consumed.next;
      continue;
    }

    out += ch;
    i++;
  }

  return out;
}

interface DevinConfigDocument {
  raw: string;
  settings: Record<string, unknown>;
}

/** 读 JSONC 配置：不存在 → 空对象；注释、尾随逗号均按 JSONC 解析。 */
async function readDevinConfig(
  path: string
): Promise<DevinConfigDocument | null> {
  let raw = "{}\n";
  try {
    raw = await readFile(path, "utf8");
  } catch {
    // missing → empty document
  }
  const errors: ParseError[] = [];
  const parsed: unknown = parse(raw, errors, {
    allowTrailingComma: true,
    disallowComments: false,
  });
  if (
    errors.length > 0 ||
    !parsed ||
    typeof parsed !== "object" ||
    Array.isArray(parsed)
  ) {
    return null;
  }
  return { raw, settings: parsed as Record<string, unknown> };
}

/**
 * JSONC 配置变换落盘（Devin 专用）：只编辑发生变化的 `hooks.<Event>`
 * 值，保留顶层未知字段、用户注释、键顺序和未触及的格式。
 */
async function transformDevinConfig(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const document = await readDevinConfig(path);
  if (document === null) {
    console.warn("[agent-hooks:devin] config unparsable, skip:", path);
    return;
  }
  const next = transform(document.settings);
  if (
    next === document.settings ||
    JSON.stringify(next) === JSON.stringify(document.settings)
  ) {
    return;
  }

  const currentHooks = hooksRecordForJsonc(document.settings);
  const nextHooks = hooksRecordForJsonc(next);
  const eventNames = new Set([
    ...Object.keys(currentHooks),
    ...Object.keys(nextHooks),
  ]);
  const formatting: FormattingOptions = {
    eol: "\n",
    insertSpaces: true,
    tabSize: 2,
  };
  let updated = document.raw;
  for (const eventName of eventNames) {
    const currentValue = currentHooks[eventName];
    const nextValue = nextHooks[eventName];
    if (JSON.stringify(currentValue) === JSON.stringify(nextValue)) {
      continue;
    }
    updated = applyEdits(
      updated,
      modify(updated, ["hooks", eventName], nextValue, {
        formattingOptions: formatting,
      })
    );
  }
  if (updated !== document.raw) {
    await atomicWriteFile(path, updated);
  }
}

function hooksRecordForJsonc(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = settings.hooks;
  return hooks && typeof hooks === "object" && !Array.isArray(hooks)
    ? (hooks as Record<string, unknown>)
    : {};
}

export const devinIntegration: AgentHookIntegration = {
  detect: () => existsSync(devinConfigPath()) || commandExistsOnPath("devin"),
  id: DEVIN_SPEC.agentId,
  runtime: {
    emittedMappings: DEVIN_SPEC.events.map(({ nativeEvent, pierEvent }) => ({
      nativeEvent,
      pierEvent,
    })),
    stopAuthority: "advisory",
  },
  install: () =>
    transformDevinConfig(devinConfigPath(), (s) => {
      if (!preflightPierNestedHooksInstall(s, DEVIN_SPEC)) {
        return s;
      }
      return transformPierHooksUnlessNewer(s, (current) =>
        withPierNestedHooks(withoutPierNestedHooks(current), DEVIN_SPEC)
      );
    }),
  uninstall: () =>
    transformDevinConfig(devinConfigPath(), withoutPierNestedHooks),
};
