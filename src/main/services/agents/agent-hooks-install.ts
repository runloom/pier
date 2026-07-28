import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  GREETING_ONLY_SOURCE,
  MAX_AGENT_SESSION_TITLE_LENGTH,
  MAX_PROMPT_SNIPPET_LENGTH,
} from "@shared/agent-session-title/index.ts";

/**
 * 实例私有事件日志目录名（相对 userData）。
 * 仅 events.jsonl / offset 落在此；可执行 hook 脚本不在此（见 pierHooksHomeDir）。
 */
export const AGENT_HOOKS_DIR_NAME = "agent-hooks";

/** emit 脚本文件名。 */
export const EMIT_SCRIPT_NAME = "emit";

/**
 * stdin → metadataBase64 提取脚本（含 promptSnippet）。
 * hooks.json 经 `${PIER_AGENT_HOOKS_DIR}/extract-stdin-meta` 调用。
 */
export const EXTRACT_STDIN_META_SCRIPT_NAME = "extract-stdin-meta";

/**
 * Claude UserPromptSubmit 会话标题派生脚本。
 * hooks.json 只引用 `${PIER_AGENT_HOOKS_DIR}/derive-claude-session-title`。
 */
export const DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME =
  "derive-claude-session-title";

/** events.jsonl 文件名（实例私有，在 userData/agent-hooks/）。 */
export const EVENTS_JSONL_NAME = "events.jsonl";

/** 用户级共享 hooks 运行时根：`~/.pier/hooks`。 */
export const PIER_HOOKS_HOME_SEGMENTS = [".pier", "hooks"] as const;

/** 世代指针文件名（内容为十进制世代号）。 */
export const PIER_HOOKS_GENERATION_FILE = "GENERATION";

/** 当前运行时 symlink 名 → `v{N}`。 */
export const PIER_HOOKS_CURRENT_NAME = "current";

/**
 * hooks 命令 + 共享运行时世代（只增不减）。
 * 2 = PromptSubmit 命名所需的 prompt → promptSnippet。
 * 3 = 世代标记改为赋值（禁止 `#` 注释，避免 `;` 拼接后整行被注释掉）。
 * 4 = stdin 身份字段补 camelCase（toolUseId / toolName / turnId / agentId /
 *     agentType / transcriptPath）；Grok 等 provider 官方 envelope 为 camelCase。
 * 5 = 全局 hooks 命令去掉 process.execPath 内联 fallback；只引用
 *     `${PIER_AGENT_HOOKS_DIR}/…`。共享运行时迁入 `~/.pier/hooks/vN`，
 *     只允许更高（或相等刷新）世代写入；旧客户端不得降级。
 * 6 = extract/derive 改为 `#!/usr/bin/env node` 纯脚本，运行时不再绑定
 *     Electron 绝对路径（金标准：同 gen 多实例零路径互盖）。
 */
export const PIER_HOOK_COMMAND_GENERATION = 6;

/**
 * emit 脚本内容——保留 v1 agentEvent，并以 agentEventV2 承载新协议。
 *
 * 位置参数：
 * - `$1` = kind（commandStart | commandFinished | agentEvent | agentEventV2）
 * - commandStart: `$2` = 命令行文本
 * - commandFinished: `$2` = 退出码（整数字符串）
 * - agentEvent（旧协议）: `$2` = agent id，`$3` = pierEvent 名，`$4..$11`
 *   为身份字段；继续写 v1，保证升级期间旧配置调用新脚本不发生参数错位。
 * - agentEventV2: `$2` = agent id，`$3` = pierEvent 名，`$4` = 原生事件名，
 *   `$5..$12` 依次为
 *   sessionId / turnId / toolUseId / toolName / agentInstanceId / agentType /
 *   transcriptPath / 已筛选身份元数据的 base64（均可为空，不含 prompt/tool input）。
 *
 * 要点：
 * - PIER_PANEL_ID / PIER_WINDOW_ID 缺失时 exit 0（非 Pier 启动的 agent 静默跳过）
 * - macOS 默认 date 不支持 %N，fallback 到 %s000000000
 * - `_var` 下划线前缀避免污染宿主 shell 变量命名空间
 * - 未知 kind → case 无匹配 → 静默 no-op
 *
 * commandStart 命令行清洗（避免破坏 JSONL 行结构）：
 *   1. `head -c 4096` 先按原文截断（避免 escape 后再截切在 `\"` 中间造成孤立 `\`）
 *   2. `LC_ALL=C tr -d '\000-\037\177'` 剥掉所有 C0 控制字符（含 \t \n \r 与 NUL 与 DEL）
 *      —— cmdline 里带真实换行会让 observer 按 `\n` split 拆行，破坏 JSON 结构。
 *      语义损失（多行命令折成一行）可接受：cmdline 只用于显示。
 *   3. `sed 's/\\/\\\\/g; s/"/\\"/g'` 转义 `\` 与 `"` 以嵌入 JSON string。
 */
const EMIT_SCRIPT = `#!/bin/sh
[ -z "$PIER_PANEL_ID" ] && exit 0
[ -z "$PIER_WINDOW_ID" ] && exit 0
[ -z "$PIER_AGENT_EVENT_LOG" ] && PIER_AGENT_EVENT_LOG="\${HOME}/.pier/agent-events.jsonl"
mkdir -p "$(dirname "$PIER_AGENT_EVENT_LOG")"
_ts=$(date +%s%N 2>/dev/null || date +%s000000000)
_lock="\${PIER_AGENT_EVENT_LOG}.lock"
_lock_token="$$.$_ts"
_lock_candidate="$_lock.$_lock_token"
printf '%s' "$_lock_token" > "$_lock_candidate" || exit 0
_lock_attempt=0
while ! ln "$_lock_candidate" "$_lock" 2>/dev/null; do
  _lock_attempt=$((_lock_attempt + 1))
  if [ "$_lock_attempt" -ge 500 ]; then
    rm -f "$_lock_candidate"
    exit 0
  fi
  sleep 0.01
done
rm -f "$_lock_candidate"
trap '[ "$(cat "$_lock" 2>/dev/null || true)" = "$_lock_token" ] && rm -f "$_lock"; rm -f "$_lock_candidate"' EXIT HUP INT TERM
case "$1" in
  commandStart)
    _cmd=$(printf '%s' "$2" | head -c 4096 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    printf '{"v":1,"kind":"commandStart","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"commandLine":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$_cmd" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  commandFinished)
    printf '{"v":1,"kind":"commandFinished","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"exitCode":%s}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEvent)
    _sid=$(printf '%s' "$4" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _turn=$(printf '%s' "$5" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_id=$(printf '%s' "$6" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_name=$(printf '%s' "$7" | head -c 256 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_instance=$(printf '%s' "$8" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_type=$(printf '%s' "$9" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _transcript=$(printf '%s' "\${10}" | head -c 8192 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _metadata_b64=$(printf '%s' "\${11}" | head -c 16384 | LC_ALL=C tr -cd 'A-Za-z0-9+/=')
    printf '{"v":1,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s","sessionId":"%s","turnId":"%s","toolUseId":"%s","toolName":"%s","agentInstanceId":"%s","agentType":"%s","transcriptPath":"%s","metadataBase64":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" "$3" "$_sid" "$_turn" "$_tool_id" "$_tool_name" "$_agent_instance" "$_agent_type" "$_transcript" "$_metadata_b64" >> "$PIER_AGENT_EVENT_LOG"
    ;;
  agentEventV2)
    _native=$(printf '%s' "$4" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _sid=$(printf '%s' "$5" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _turn=$(printf '%s' "$6" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_id=$(printf '%s' "$7" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _tool_name=$(printf '%s' "$8" | head -c 256 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_instance=$(printf '%s' "$9" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _agent_type=$(printf '%s' "\${10}" | head -c 128 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _transcript=$(printf '%s' "\${11}" | head -c 8192 | LC_ALL=C tr -d '\\000-\\037\\177' | sed 's/\\\\/\\\\\\\\/g; s/"/\\\\"/g')
    _metadata_b64=$(printf '%s' "\${12}" | head -c 16384 | LC_ALL=C tr -cd 'A-Za-z0-9+/=')
    printf '{"v":2,"kind":"agentEvent","ts":%s,"panelId":"%s","windowId":"%s","pid":%s,"agent":"%s","event":"%s","nativeEvent":"%s","sessionId":"%s","turnId":"%s","toolUseId":"%s","toolName":"%s","agentInstanceId":"%s","agentType":"%s","transcriptPath":"%s","metadataBase64":"%s"}\\n' \\
      "$_ts" "$PIER_PANEL_ID" "$PIER_WINDOW_ID" "$$" "$2" "$3" "$_native" "$_sid" "$_turn" "$_tool_id" "$_tool_name" "$_agent_instance" "$_agent_type" "$_transcript" "$_metadata_b64" >> "$PIER_AGENT_EVENT_LOG"
    ;;
esac
[ "$(cat "$_lock" 2>/dev/null || true)" = "$_lock_token" ] && rm -f "$_lock"
trap - EXIT HUP INT TERM
`;

export interface InstallAgentHooksOptions {
  /**
   * 共享运行时根目录。默认 `~/.pier/hooks`。
   * 测试可注入临时目录，避免污染开发机 home。
   */
  hooksHome?: string;
}

/** 用户级共享 hooks 运行时根目录。 */
export function pierHooksHomeDir(home: string = homedir()): string {
  return join(home, ...PIER_HOOKS_HOME_SEGMENTS);
}

/** `current` 目录（symlink 到 `v{N}`）；PTY 的 PIER_AGENT_HOOKS_DIR 指向此路径。 */
export function pierHooksCurrentDir(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(hooksHome, PIER_HOOKS_CURRENT_NAME);
}

/** 版本化运行时目录 `…/v{N}`。 */
export function pierHooksVersionDir(
  generation: number,
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(hooksHome, `v${generation}`);
}

/**
 * 实例私有 agent-hooks 目录（仅事件日志等）。
 * 可执行脚本请用 pierHooksCurrentDir / emitScriptPath(hooksHome)。
 */
export function agentHooksDir(userData: string): string {
  return join(userData, AGENT_HOOKS_DIR_NAME);
}

/** emit 脚本路径（经 current）。 */
export function emitScriptPath(hooksHome: string = pierHooksHomeDir()): string {
  return join(pierHooksCurrentDir(hooksHome), EMIT_SCRIPT_NAME);
}

/** extract-stdin-meta 路径（经 current）。 */
export function extractStdinMetaScriptPath(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(pierHooksCurrentDir(hooksHome), EXTRACT_STDIN_META_SCRIPT_NAME);
}

/** derive-claude-session-title 路径（经 current）。 */
export function deriveClaudeSessionTitleScriptPath(
  hooksHome: string = pierHooksHomeDir()
): string {
  return join(
    pierHooksCurrentDir(hooksHome),
    DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME
  );
}

/** 返回实例私有 events.jsonl 绝对路径。 */
export function eventsJsonlPath(userData: string): string {
  return join(agentHooksDir(userData), EVENTS_JSONL_NAME);
}

/** 读取磁盘上已安装的共享运行时世代；缺失/损坏 → 0。 */
export async function readInstalledHookRuntimeGeneration(
  hooksHome: string = pierHooksHomeDir()
): Promise<number> {
  try {
    const raw = await readFile(
      join(hooksHome, PIER_HOOKS_GENERATION_FILE),
      "utf8"
    );
    const value = Number(raw.trim());
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

/**
 * extract-stdin-meta：`#!/usr/bin/env node` 纯脚本。
 * stdin JSON → stdout base64(metadata)，含 promptSnippet（截断长度用
 * MAX_PROMPT_SNIPPET_LENGTH）。
 * 键表与 hook-stdin-commands 的 sed 提取保持同步（snake + camel）。
 * **不绑定** Electron/process.execPath——PATH 上的 node 即可。
 */
export function buildExtractStdinMetaScript(): string {
  return `#!/usr/bin/env node
// pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}
// Managed by Pier. Do not edit.
"use strict";
const MAX_SNIPPET = ${MAX_PROMPT_SNIPPET_LENGTH};
const KEYS = [
  "session_id",
  "sessionId",
  "turn_id",
  "turnId",
  "tool_use_id",
  "toolUseId",
  "tool_name",
  "toolName",
  "agent_id",
  "agentId",
  "agent_type",
  "agentType",
  "transcript_path",
  "transcriptPath",
];
let s = "";
process.stdin.on("data", (d) => {
  s += d;
});
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(s);
    const o = {};
    for (const k of KEYS) {
      if (typeof p[k] === "string") {
        o[k] = p[k];
      }
    }
    const prompt = [p.prompt, p.user_prompt, p.content, p.message].find(
      (v) => typeof v === "string"
    );
    if (typeof prompt === "string" && prompt.trim()) {
      o.promptSnippet = prompt.slice(0, MAX_SNIPPET);
    }
    process.stdout.write(Buffer.from(JSON.stringify(o)).toString("base64"));
  } catch {
    // best-effort
  }
});
`;
}

/**
 * derive-claude-session-title：`#!/usr/bin/env node` 纯脚本。
 * stdin JSON → stdout hookSpecificOutput.sessionTitle。
 * 只做 strip + 寒暄挡 + 硬截断（与历史内联逻辑一致）。
 * **不绑定** Electron/process.execPath。
 */
export function buildDeriveClaudeSessionTitleScript(): string {
  const greetingLiteral = JSON.stringify(GREETING_ONLY_SOURCE);
  const cap = MAX_AGENT_SESSION_TITLE_LENGTH;
  const snippetCap = MAX_PROMPT_SNIPPET_LENGTH;
  return `#!/usr/bin/env node
// pier-hook-gen=${PIER_HOOK_COMMAND_GENERATION}
// Managed by Pier. Do not edit.
"use strict";
const GREETING_ONLY_SOURCE = ${greetingLiteral};
const MAX_TITLE = ${cap};
const MAX_SNIPPET = ${snippetCap};
let s = "";
process.stdin.on("data", (d) => {
  s += d;
});
process.stdin.on("end", () => {
  try {
    const p = JSON.parse(s);
    const raw = [p.prompt, p.user_prompt, p.content, p.message].find(
      (v) => typeof v === "string"
    );
    if (typeof raw !== "string") {
      return;
    }
    let t = String(raw)
      .slice(0, MAX_SNIPPET)
      .replace(/\\r\\n/g, "\\n")
      .replace(/\\r/g, "\\n");
    const m =
      /<(user_query|user_message|user_prompt|human|query)\\b[^>]*>([\\s\\S]*?)<\\/\\1>/i.exec(
        t
      );
    if (m && m[2].trim()) {
      t = m[2];
    }
    t = t
      .replace(
        /<\\/?(?:user_query|user_message|user_prompt|human|query|system|assistant)\\b[^>]*>/gi,
        " "
      )
      .replace(/\\[Image\\s*#?\\d*\\]/gi, " ")
      .replace(/!\\[[^\\]]*\\]\\([^)]*\\)/g, " ")
      .replace(/\\s+/g, " ")
      .trim();
    if (!t || new RegExp(GREETING_ONLY_SOURCE, "i").test(t)) {
      return;
    }
    if (t.length > MAX_TITLE) {
      t = t.slice(0, MAX_TITLE - 1).trimEnd() + "…";
    }
    if (!t || t.includes("\\n")) {
      return;
    }
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          sessionTitle: t,
          suppressOutput: true,
        },
      })
    );
  } catch {
    // best-effort
  }
});
`;
}

async function writeExecutable(path: string, body: string): Promise<void> {
  await writeFile(path, body, { mode: 0o755 });
  // writeFile 的 mode 仅在创建时生效；覆盖写时显式 chmod 保证 +x。
  await chmod(path, 0o755);
}

/** 内容相同则跳过字节写入，但仍确保 +x（同 gen 多实例 / 自愈可恢复权限）。 */
async function writeExecutableIfChanged(
  path: string,
  body: string
): Promise<void> {
  try {
    const existing = await readFile(path, "utf8");
    if (existing === body) {
      await chmod(path, 0o755);
      return;
    }
  } catch {
    // missing → write
  }
  await writeExecutable(path, body);
}

/**
 * 将 `current` 原子切换为指向相对目标（如 `v5`）。
 * staging + rename，避免半更新。
 */
export async function atomicReplaceSymlink(
  linkPath: string,
  relativeTarget: string
): Promise<void> {
  const staging = `${linkPath}.tmp.${process.pid}.${Date.now()}`;
  await symlink(relativeTarget, staging);
  try {
    await rename(staging, linkPath);
  } catch {
    // 目标若为非空目录等无法 rename 覆盖，先移除再换。
    await rm(linkPath, { force: true, recursive: true });
    await rename(staging, linkPath);
  }
}

/**
 * 安装共享 hook 运行时 + 确保实例事件日志目录存在。
 *
 * 布局：
 * ```
 * ~/.pier/hooks/
 *   GENERATION          # 当前世代
 *   v6/emit             # 纯 shell
 *   v6/extract-…        # #!/usr/bin/env node（无 Electron 路径）
 *   v6/derive-…         # #!/usr/bin/env node
 *   current → v6        # PTY 注入 PIER_AGENT_HOOKS_DIR
 * {userData}/agent-hooks/events.jsonl   # 实例私有日志
 * ```
 *
 * 只前进规则：
 * - 磁盘世代 > 本进程 → 跳过（旧客户端不得降级）
 * - 磁盘世代 < 本进程 → 写入 `v{本世代}`、切换 current、更新 GENERATION
 * - 磁盘世代 == 本进程 → 仅当脚本内容变化时重写（同 gen 多实例内容相同则零 IO）
 */
export async function installAgentHooksEmitScript(
  userData: string,
  options: InstallAgentHooksOptions = {}
): Promise<void> {
  const hooksHome = options.hooksHome ?? pierHooksHomeDir();
  const gen = PIER_HOOK_COMMAND_GENERATION;

  // 实例私有日志目录（observer / PIER_AGENT_EVENT_LOG）
  await mkdir(agentHooksDir(userData), { recursive: true });

  const installed = await readInstalledHookRuntimeGeneration(hooksHome);
  if (installed > gen) {
    return;
  }

  await mkdir(hooksHome, { recursive: true });
  const versionDir = pierHooksVersionDir(gen, hooksHome);
  await mkdir(versionDir, { recursive: true });

  const extractBody = buildExtractStdinMetaScript();
  const deriveBody = buildDeriveClaudeSessionTitleScript();
  await writeExecutableIfChanged(
    join(versionDir, EMIT_SCRIPT_NAME),
    EMIT_SCRIPT
  );
  await writeExecutableIfChanged(
    join(versionDir, EXTRACT_STDIN_META_SCRIPT_NAME),
    extractBody
  );
  await writeExecutableIfChanged(
    join(versionDir, DERIVE_CLAUDE_SESSION_TITLE_SCRIPT_NAME),
    deriveBody
  );

  await atomicReplaceSymlink(pierHooksCurrentDir(hooksHome), `v${gen}`);
  if (installed !== gen) {
    await writeFile(
      join(hooksHome, PIER_HOOKS_GENERATION_FILE),
      `${gen}\n`,
      "utf8"
    );
  }
}

/** 测试/诊断：current 是否为指向 vN 的 symlink。 */
export async function isPierHooksCurrentSymlink(
  hooksHome: string = pierHooksHomeDir()
): Promise<boolean> {
  try {
    const st = await lstat(pierHooksCurrentDir(hooksHome));
    return st.isSymbolicLink();
  } catch {
    return false;
  }
}
