import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** pier hook 命令的识别标记（命令文本必然包含该环境变量名）。 */
const PIER_HOOK_MARK = "PIER_AGENT_HOOK_PORT";

/**
 * Claude Code hook 事件 → pier 事件名。
 * 依据官方 hooks reference（code.claude.com/docs/en/hooks）：
 * - 权限等待用专用 PermissionRequest 事件；不装 Notification（它还
 *   覆盖 idle_prompt / auth_success 等与状态无关的通知）。
 * - StopFailure = 回合因 API 错误终止 → pier "error" → tab failed。
 * - PostToolUseFailure = 单个工具失败, 回合仍在继续 → 视为 ToolComplete
 *   （不闪 error, error 态只留给回合级失败）。
 */
const CLAUDE_HOOK_EVENTS: ReadonlyArray<{
  claudeEvent: string;
  pierEvent: string;
}> = [
  { claudeEvent: "SessionStart", pierEvent: "SessionStart" },
  { claudeEvent: "UserPromptSubmit", pierEvent: "PromptSubmit" },
  { claudeEvent: "PreToolUse", pierEvent: "ToolStart" },
  { claudeEvent: "PostToolUse", pierEvent: "ToolComplete" },
  { claudeEvent: "PostToolUseFailure", pierEvent: "ToolComplete" },
  { claudeEvent: "PermissionRequest", pierEvent: "PermissionRequest" },
  // 拒绝授权后 turn 继续（模型收到 denial 继续推理）——不装则 waiting 卡到 TTL。
  { claudeEvent: "PermissionDenied", pierEvent: "processing" },
  // 长压缩期间无其他 hook, 不装则状态可能被 30min TTL 误衰减为 ready。
  { claudeEvent: "PreCompact", pierEvent: "processing" },
  { claudeEvent: "Stop", pierEvent: "Stop" },
  { claudeEvent: "StopFailure", pierEvent: "error" },
  { claudeEvent: "SubagentStart", pierEvent: "SubagentStart" },
  { claudeEvent: "SubagentStop", pierEvent: "SubagentStop" },
  { claudeEvent: "SessionEnd", pierEvent: "SessionEnd" },
];

interface ClaudeHookCommand {
  command: string;
  timeout?: number;
  type: "command";
}
interface ClaudeHookMatcher {
  hooks: ClaudeHookCommand[];
  matcher?: string;
}

/**
 * 生成静态 hook 命令：端口/token/panelId 运行时从环境变量读（PTY 注入,
 * shell 子进程继承），Pier 外启动的 claude 因变量缺失直接短路退出。
 * 尾部 `|| true` 保证 hook 永远 exit 0, 不干扰 agent 本体。
 */
export function pierHookCommand(pierEvent: string): string {
  const payload = `{\\"v\\":1,\\"agent\\":\\"claude\\",\\"event\\":\\"${pierEvent}\\",\\"panelId\\":\\"$PIER_PANEL_ID\\",\\"windowId\\":\\"$PIER_WINDOW_ID\\"}`;
  return (
    `[ -n "$${PIER_HOOK_MARK}" ] && [ -n "$PIER_PANEL_ID" ] && [ -n "$PIER_WINDOW_ID" ] && ` +
    `curl -fsS -m 2 -X POST "http://127.0.0.1:$${PIER_HOOK_MARK}/agent-event" ` +
    `-H "Authorization: Bearer $PIER_AGENT_HOOK_TOKEN" ` +
    `-H "Content-Type: application/json" ` +
    `-d "${payload}" >/dev/null 2>&1 || true`
  );
}

function isPierMatcher(entry: unknown): boolean {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  const hooks = (entry as ClaudeHookMatcher).hooks;
  return (
    Array.isArray(hooks) &&
    hooks.some(
      (h) =>
        typeof h?.command === "string" && h.command.includes(PIER_HOOK_MARK)
    )
  );
}

function hooksRecord(
  settings: Record<string, unknown>
): Record<string, unknown[]> {
  const hooks = settings.hooks;
  if (hooks && typeof hooks === "object" && !Array.isArray(hooks)) {
    return { ...(hooks as Record<string, unknown[]>) };
  }
  return {};
}

/** 纯函数：注入 pier hook 条目（幂等——先剔旧再加新）。 */
export function withPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  for (const { claudeEvent, pierEvent } of CLAUDE_HOOK_EVENTS) {
    const existing = Array.isArray(hooks[claudeEvent])
      ? hooks[claudeEvent]
      : [];
    const kept = existing.filter((entry) => !isPierMatcher(entry));
    const pierEntry: ClaudeHookMatcher = {
      hooks: [
        { command: pierHookCommand(pierEvent), timeout: 5, type: "command" },
      ],
    };
    hooks[claudeEvent] = [...kept, pierEntry];
  }
  return { ...settings, hooks };
}

/**
 * 纯函数：剔除全部 pier hook 条目, 空事件键一并删除。
 * 无 pier 条目时原样返回输入引用——启动期的「关→卸载」对齐每次都会跑,
 * 不能给从未安装过的用户凭空引入 hooks 键或触发重写。
 */
export function withoutPierClaudeHooks(
  settings: Record<string, unknown>
): Record<string, unknown> {
  const hooks = hooksRecord(settings);
  let changed = false;
  for (const key of Object.keys(hooks)) {
    const entries = Array.isArray(hooks[key]) ? hooks[key] : [];
    const kept = entries.filter((entry) => !isPierMatcher(entry));
    if (kept.length === entries.length) {
      continue;
    }
    changed = true;
    if (kept.length > 0) {
      hooks[key] = kept;
    } else {
      delete hooks[key];
    }
  }
  if (!changed) {
    return settings;
  }
  return { ...settings, hooks };
}

function defaultSettingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

async function readSettings(
  path: string
): Promise<Record<string, unknown> | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return {}; // 文件不存在 → 从空配置开始
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null; // 已损坏 → 不动用户文件
  }
}

async function atomicWrite(path: string, data: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.pier-tmp`;
  await writeFile(tmp, data, "utf8");
  await rename(tmp, path);
}

async function transformSettings(
  path: string,
  transform: (s: Record<string, unknown>) => Record<string, unknown>
): Promise<void> {
  const settings = await readSettings(path);
  if (settings === null) {
    console.warn(
      "[claude-hook-installer] settings.json unparsable, skip:",
      path
    );
    return;
  }
  const next = transform(settings);
  // 语义无变化不落盘：保护用户文件的既有格式, 也让幂等重装/空卸载零副作用。
  if (next === settings || JSON.stringify(next) === JSON.stringify(settings)) {
    return;
  }
  await atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`);
}

export async function installClaudeHooks(
  settingsPath: string = defaultSettingsPath()
): Promise<void> {
  await transformSettings(settingsPath, withPierClaudeHooks);
}

export async function uninstallClaudeHooks(
  settingsPath: string = defaultSettingsPath()
): Promise<void> {
  await transformSettings(settingsPath, withoutPierClaudeHooks);
}

export async function applyAgentStatusHooksPreference(
  enabled: boolean
): Promise<void> {
  await (enabled ? installClaudeHooks() : uninstallClaudeHooks());
}
