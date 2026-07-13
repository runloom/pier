import { existsSync } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AgentKind } from "@shared/contracts/agent.ts";
import { atomicWriteFile, commandExistsOnPath } from "./shared.ts";
import type { AgentHookIntegration } from "./types.ts";

const AGENT_ID: AgentKind = "hermes";
const PLUGIN_NAME = "pier-status";
const MARKER = "pier-agent-status:v1 (managed by Pier)";

/**
 * hermes 事件 → pier 事件名（capability "coarse"——无真回合结束信号）。
 *
 * hermes 的 `post_llm_call` 在每轮 LLM 调用后触发, 而非回合结束; 多工具
 * 循环中映射 Stop 会在工具执行期间谎报「等待输入」, 且 turnEnded 吸收后续
 * ToolStart/ToolComplete——与 omp turn_end→Stop 完全同源。hermes 事件体系
 * 无真正的用户可见回合终结事件, 故不映射 Stop。
 * 通用不变式：宁可 false-busy（漏报 ready, 危害小）, 不可 false-idle
 *（谎报 ready, 吸收工具事件, 正是 omp 原 bug）。
 *
 * `on_session_reset` 是唯一例外：reset 后 agent 确实回到等待输入状态,
 * 且下一轮 `pre_llm_call→processing` 能及时解除吸收。
 *
 * `post_approval_response` → ToolStart：与 omp 同理——批准路径（绝大多数）
 * 立即准确；拒绝路径短暂错标 tool, 由后续事件纠正。
 */
const HERMES_EVENTS: ReadonlyArray<{ nativeEvent: string; pierEvent: string }> =
  [
    { nativeEvent: "on_session_start", pierEvent: "SessionStart" },
    { nativeEvent: "pre_llm_call", pierEvent: "processing" },
    { nativeEvent: "pre_tool_call", pierEvent: "ToolStart" },
    { nativeEvent: "post_tool_call", pierEvent: "ToolComplete" },
    { nativeEvent: "pre_approval_request", pierEvent: "PermissionRequest" },
    { nativeEvent: "post_approval_response", pierEvent: "ToolStart" },
    { nativeEvent: "on_session_end", pierEvent: "SessionEnd" },
    { nativeEvent: "on_session_finalize", pierEvent: "SessionEnd" },
    { nativeEvent: "on_session_reset", pierEvent: "Stop" },
  ];

export function hermesHome(): string {
  const raw = (process.env.HERMES_HOME ?? "").trim();
  return raw.length > 0 ? raw : join(homedir(), ".hermes");
}

export function hermesConfigPath(): string {
  return join(hermesHome(), "config.yaml");
}

export function hermesPluginDir(): string {
  return join(hermesHome(), "plugins", PLUGIN_NAME);
}

export function hermesManifestPath(): string {
  return join(hermesPluginDir(), "plugin.yaml");
}

export function hermesInitPath(): string {
  return join(hermesPluginDir(), "__init__.py");
}

export function hermesDetect(): boolean {
  return existsSync(hermesHome()) || commandExistsOnPath("hermes");
}

export function buildHermesPluginManifest(): string {
  const eventLines = HERMES_EVENTS.map((e) => `  - ${e.nativeEvent}`).join(
    "\n"
  );
  return `# ${MARKER}
name: ${PLUGIN_NAME}
version: 1.0.0
description: "Reports Hermes agent lifecycle events to Pier."
author: "Pier"
kind: standalone
provides_hooks:
${eventLines}
`;
}

/**
 * Python 插件入口。emit 内嵌：`os.environ` 读三个 PIER_ 变量, 缺任一静默
 * no-op；`open(..., "a")` append 写 JSONL, except 吞异常
 * （payload 精简为 pier v1 agentEvent schema）。
 * POSIX 保证 <4KB append 原子。
 */
export function buildHermesPluginInit(): string {
  const eventNames = HERMES_EVENTS.map((e) => `"${e.nativeEvent}"`).join(", ");
  const eventMapEntries = HERMES_EVENTS.map(
    (e) => `    "${e.nativeEvent}": "${e.pierEvent}",`
  ).join("\n");
  return `# ${MARKER}
from __future__ import annotations

import json
import os
import time
from typing import Any, Callable

EVENTS = (${eventNames})

EVENT_MAP = {
${eventMapEntries}
}


def _pier_session_id_from(value: Any) -> str | None:
    if not isinstance(value, dict):
        return None
    for key in ("sessionId", "sessionID", "session_id"):
        candidate = value.get(key)
        if isinstance(candidate, str) and candidate:
            return candidate
    for key in ("session", "thread", "context", "ctx"):
        nested = value.get(key)
        if isinstance(nested, dict):
            for nested_key in ("id", "sessionId", "sessionID", "session_id"):
                candidate = nested.get(nested_key)
                if isinstance(candidate, str) and candidate:
                    return candidate
    return None


def _pier_emit(pier_event: str, native_event: str, payload: dict[str, Any]) -> None:
    log = os.environ.get("PIER_AGENT_EVENT_LOG", "")
    panel_id = os.environ.get("PIER_PANEL_ID", "")
    window_id = os.environ.get("PIER_WINDOW_ID", "")
    if not log or not panel_id or not window_id:
        return
    body = {
        "v": 2,
        "kind": "agentEvent",
        "ts": int(time.time_ns()),
        "panelId": panel_id,
        "windowId": window_id,
        "pid": os.getpid(),
        "agent": "hermes",
        "event": pier_event,
        "nativeEvent": native_event,
    }
    session_id = _pier_session_id_from(payload)
    if session_id:
        body["sessionId"] = session_id
    line = json.dumps(
        body
    ) + "\\n"
    lock = log + ".lock"
    token = f"{os.getpid()}.{time.time_ns()}"
    candidate = lock + "." + token
    try:
        with open(candidate, "x", encoding="ascii") as fp:
            fp.write(token)
    except OSError:
        return
    acquired = False
    for _ in range(500):
        try:
            os.link(candidate, lock)
            acquired = True
            break
        except FileExistsError:
            time.sleep(0.01)
        except OSError:
            return
    try:
        os.remove(candidate)
    except OSError:
        pass
    if not acquired:
        return
    try:
        with open(log, "a", encoding="utf-8") as fp:
            fp.write(line)
    except OSError:
        pass
    finally:
        try:
            with open(lock, encoding="ascii") as fp:
                if fp.read() == token:
                    os.remove(lock)
        except OSError:
            pass


def _make_hook(event_name: str) -> Callable[..., None]:
    pier_event = EVENT_MAP[event_name]

    def _hook(**kwargs: Any) -> None:
        _pier_emit(pier_event, event_name, kwargs)

    return _hook


def register(ctx: Any) -> None:
    for event_name in EVENTS:
        ctx.register_hook(event_name, _make_hook(event_name))
`;
}

function isManagedByPier(raw: string): boolean {
  return raw.includes(MARKER);
}

async function readFileRaw(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** 插件文件双托管检测：manifest + init 都存在且都含 marker 才算托管。 */
async function pluginManagedState(): Promise<{
  present: boolean;
  managed: boolean;
}> {
  const manifest = await readFileRaw(hermesManifestPath());
  const init = await readFileRaw(hermesInitPath());
  if (manifest === null || init === null) {
    return { present: false, managed: false };
  }
  return {
    present: true,
    managed: isManagedByPier(manifest) && isManagedByPier(init),
  };
}

async function writePluginFiles(): Promise<void> {
  await mkdir(hermesPluginDir(), { recursive: true });
  await atomicWriteFile(hermesManifestPath(), buildHermesPluginManifest());
  await atomicWriteFile(hermesInitPath(), buildHermesPluginInit());
}

// ---------------------------------------------------------------------------
// config.yaml 的 plugins.enabled 文本级处理（wave-1 goose 纪律：无解析器,
// 只做保守插入；`plugins:` 结构异常时 warn 跳过, 不破坏用户文件）。
// ---------------------------------------------------------------------------

const TOP_LEVEL_PLUGINS_KEY_RE = /^plugins:\s*$/m;
const PLUGINS_KEY_LINE_RE = /^plugins:\s*$/;
const NON_INDENTED_LINE_RE = /^\S/;
const ENABLED_BLOCK_KEY_RE = /^ {2}enabled:\s*$/;
const ENABLED_INLINE_KEY_RE = /^ {2}enabled:\s*\S.*$/;
const ENABLED_LIST_ITEM_RE = /^( {4}- )(.+)$/;
const TRAILING_NEWLINE_RE = /\n$/;

interface PluginsBlockLocation {
  /** true = enabled: 存在但非受支持的块列表形式（如内联数组）→ 结构异常。 */
  enabledIsMalformed: boolean;
  enabledLine: number | null;
  /** `plugins:` 行之后、下一个非缩进顶层键（或 EOF）之前的行范围（含）。 */
  endLine: number;
  startLine: number;
}

function findPluginsBlock(lines: string[]): PluginsBlockLocation | null {
  const startLine = lines.findIndex((l) => PLUGINS_KEY_LINE_RE.test(l));
  if (startLine === -1) {
    return null;
  }
  let endLine = lines.length - 1;
  for (let i = startLine + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.length > 0 && NON_INDENTED_LINE_RE.test(line)) {
      endLine = i - 1;
      break;
    }
  }
  let enabledLine: number | null = null;
  let enabledIsMalformed = false;
  for (let i = startLine + 1; i <= endLine; i++) {
    const line = lines[i] ?? "";
    if (ENABLED_BLOCK_KEY_RE.test(line)) {
      enabledLine = i;
      break;
    }
    if (ENABLED_INLINE_KEY_RE.test(line)) {
      enabledLine = i;
      enabledIsMalformed = true;
      break;
    }
  }
  return { enabledIsMalformed, endLine, enabledLine, startLine };
}

/**
 * 保守文本插入：`plugins:` 顶层键不存在 → 追加整块；存在但 `enabled:`
 * 子键不存在 → 在 `plugins:` 块内追加 `enabled:` 列表；`enabled:` 已存在
 * 但含非 `  - foo` 形式的子行（例如内联数组 `enabled: [a, b]`）→ 判定结构
 * 异常, 返回 null（调用方 warn 跳过, 不覆盖用户文件）。
 */
export function withHermesPluginEnabled(raw: string): string | null {
  if (raw.trim().length === 0) {
    return `plugins:\n  enabled:\n    - ${PLUGIN_NAME}\n`;
  }
  const hasTrailingNewline = raw.endsWith("\n");
  const lines = raw.replace(TRAILING_NEWLINE_RE, "").split("\n");
  const block = findPluginsBlock(lines);
  if (!block) {
    const sep = hasTrailingNewline ? "" : "\n";
    return `${raw}${sep}plugins:\n  enabled:\n    - ${PLUGIN_NAME}\n`;
  }
  if (block.enabledLine === null) {
    const insertAt = block.startLine + 1;
    const next = [
      ...lines.slice(0, insertAt),
      "  enabled:",
      `    - ${PLUGIN_NAME}`,
      ...lines.slice(insertAt),
    ];
    return `${next.join("\n")}\n`;
  }
  if (block.enabledIsMalformed) {
    return null;
  }
  // enabled: 子键已存在——收集其下的列表项行，全部须匹配 `    - foo` 形式。
  let listEnd = block.enabledLine;
  const items: string[] = [];
  for (let i = block.enabledLine + 1; i <= block.endLine; i++) {
    const line = lines[i] ?? "";
    if (line.trim().length === 0) {
      listEnd = i;
      continue;
    }
    const match = line.match(ENABLED_LIST_ITEM_RE);
    const captured = match?.[2];
    if (captured === undefined) {
      return null;
    }
    items.push(captured.trim());
    listEnd = i;
  }
  if (items.includes(PLUGIN_NAME)) {
    return raw;
  }
  const next = [
    ...lines.slice(0, listEnd + 1),
    `    - ${PLUGIN_NAME}`,
    ...lines.slice(listEnd + 1),
  ];
  return `${next.join("\n")}\n`;
}

/**
 * 从 `plugins.enabled` 列表移除本插件条目；无该条目/无 plugins 块时原样
 * 返回输入引用。同样不解析 YAML, 仅做行级删除。
 */
export function withoutHermesPluginEnabled(raw: string): string {
  if (raw.trim().length === 0) {
    return raw;
  }
  const hasTrailingNewline = raw.endsWith("\n");
  const lines = raw.replace(TRAILING_NEWLINE_RE, "").split("\n");
  const targetLine = `    - ${PLUGIN_NAME}`;
  const idx = lines.indexOf(targetLine);
  if (idx === -1) {
    return raw;
  }
  // 若移除后 `  enabled:` 变为空列表（前一行是 enabled: 键, 后一行不是同级
  // 列表项）, 一并删除该空键——保持与 withHermesPluginEnabled 生成结构对称,
  // 使 install→uninstall 回到原始字节。
  const beforeIsEnabledKey = ENABLED_BLOCK_KEY_RE.test(lines[idx - 1] ?? "");
  const afterIsListItem = ENABLED_LIST_ITEM_RE.test(lines[idx + 1] ?? "");
  const removeStart = beforeIsEnabledKey && !afterIsListItem ? idx - 1 : idx;
  const next = [...lines.slice(0, removeStart), ...lines.slice(idx + 1)];
  const joined = next.join("\n");
  return hasTrailingNewline ? `${joined}\n` : joined;
}

function hasTopLevelPluginsKey(raw: string): boolean {
  return TOP_LEVEL_PLUGINS_KEY_RE.test(raw);
}

async function readConfigRaw(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

export async function installHermesPlugin(
  configPath: string = hermesConfigPath()
): Promise<void> {
  if (!hermesDetect()) {
    return;
  }
  const raw = await readConfigRaw(configPath);
  const next = withHermesPluginEnabled(raw);
  if (next === null) {
    console.warn(
      "[agent-hooks:hermes] plugins.enabled has unrecognized structure, skip install to avoid corrupting config.yaml:",
      configPath
    );
    return;
  }
  await writePluginFiles();
  if (next !== raw) {
    await atomicWriteFile(configPath, next);
  }
}

export async function uninstallHermesPlugin(
  configPath: string = hermesConfigPath()
): Promise<void> {
  const state = await pluginManagedState();
  if (state.managed) {
    await rm(hermesPluginDir(), { force: true, recursive: true });
  }
  const raw = await readConfigRaw(configPath);
  if (!hasTopLevelPluginsKey(raw)) {
    return;
  }
  const next = withoutHermesPluginEnabled(raw);
  if (next === raw) {
    return;
  }
  await atomicWriteFile(configPath, next);
}

export const hermesIntegration: AgentHookIntegration = {
  capability: "coarse",
  detect: hermesDetect,
  id: AGENT_ID,
  runtime: { stopAuthority: "reset-only" },
  install: () => installHermesPlugin(),
  uninstall: () => uninstallHermesPlugin(),
};

/** 事件表导出（测试断言映射完整性用）。 */
export const HERMES_EVENT_MAP = HERMES_EVENTS;

/** marker / 插件名常量导出（测试断言用）。 */
export const HERMES_MARKER = MARKER;
export const HERMES_PLUGIN_NAME = PLUGIN_NAME;
