import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  atomicWriteFile,
  commandExistsOnPath,
  type NestedJsonIntegrationSpec,
  withoutPierNestedHooks,
  withPierNestedHooks,
} from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const devinConfigPath = () =>
  join(homedir(), ".config", "devin", "config.json");

/**
 * Devin hook 事件 → pier 事件名。
 * 全部不写 matcher：Devin 把 matcher 当正则，Claude 惯用的 "*" 是非法
 * 正则，写了会导致 hook 注册失败。
 *
 * 已知重叠（不做处理，仅记录）：Devin 默认 `read_config_from` 会导入
 * ~/.claude 的 hooks，若用户同时装了 claude 集成，会出现同一事件双报。
 * 有的实现用 skipWhenDevinImportsClaude 守卫规避；Pier v1 不做该守卫——
 * 聚合器对同 key（agentId+event+panelId）幂等去重，双报不影响最终状态
 * 展示，仅接受、不特殊处理。
 */
const DEVIN_SPEC: NestedJsonIntegrationSpec = {
  agentId: "devin",
  capability: "full",
  runtime: { stopAuthority: "advisory" },
  configPath: devinConfigPath,
  events: [
    { nativeEvent: "SessionStart", pierEvent: "SessionStart" },
    { nativeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
    { nativeEvent: "Stop", pierEvent: "Stop" },
    { nativeEvent: "PostCompaction", pierEvent: "processing" },
    { nativeEvent: "SessionEnd", pierEvent: "SessionEnd" },
    { nativeEvent: "PreToolUse", pierEvent: "ToolStart" },
    { nativeEvent: "PostToolUse", pierEvent: "ToolComplete" },
    { nativeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
  ],
};

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
 * 写回配置时输出纯 JSON（注释丢失）——这是接受行为，用户
 * 原有的 JSONC 注释在 Pier 写入后不会保留。
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

/** 读 JSONC 配置：不存在 → {}；剥注释后解析失败/非对象 → null（损坏）。 */
async function readDevinConfig(
  path: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(stripJsonComments(raw));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/**
 * JSONC 配置变换落盘（devin 专用，不复用工厂的 transformJsonConfig，因为
 * 后者用 readJsonConfig 会把带注释的合法 JSONC 判为损坏而跳过）。
 * 语义无变化不落盘；写回为纯 JSON（注释丢失，模块头注释已说明）。
 */
async function transformDevinConfig(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const settings = await readDevinConfig(path);
  if (settings === null) {
    console.warn("[agent-hooks:devin] config unparsable, skip:", path);
    return;
  }
  const next = transform(settings);
  if (next === settings || JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  await atomicWriteFile(path, `${JSON.stringify(next, null, 2)}\n`);
}

export const devinIntegration: AgentHookIntegration = {
  capability: DEVIN_SPEC.capability,
  detect: () => existsSync(devinConfigPath()) || commandExistsOnPath("devin"),
  id: DEVIN_SPEC.agentId,
  runtime: { stopAuthority: "advisory" },
  install: () =>
    transformDevinConfig(devinConfigPath(), (s) =>
      withPierNestedHooks(s, DEVIN_SPEC)
    ),
  uninstall: () =>
    transformDevinConfig(devinConfigPath(), withoutPierNestedHooks),
};
