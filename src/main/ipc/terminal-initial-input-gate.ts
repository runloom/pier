/**
 * Initial-input 注入门控：worktree 创建后要把 setup 命令（或 agent task
 * prompt）作为 shell 的首个 stdin 输入自动执行。如果直接在 pty 建好后立刻
 * 写入，raw tty echo 会把命令字符打在 shell 登录 banner 之前，屏幕顶部出现
 * 一行未定位的原始文本，用户看着像终端出错。
 *
 * 门控策略：注册一次性 "prompt ready" 触发。ghostty shell integration 在打
 * 第一个 prompt 前会发 OSC 7（cwd），我们以第一次 cwd 事件作为 shell 已进入
 * "读 stdin" 阶段的信号，用它触发注入。若 shell 没有集成或异常，走后备定时
 * 器兜底（不阻塞 UX，最终一定会尝试注入）。
 */

const DEFAULT_FALLBACK_MS = 1500;

interface PendingEntry {
  fire: () => void;
  timer: NodeJS.Timeout;
}

const pendingByPanelId = new Map<string, PendingEntry>();

function consume(panelId: string): PendingEntry | null {
  const entry = pendingByPanelId.get(panelId);
  if (!entry) return null;
  pendingByPanelId.delete(panelId);
  clearTimeout(entry.timer);
  return entry;
}

export function schedulePromptReady(
  panelId: string,
  fire: () => void,
  fallbackMs = DEFAULT_FALLBACK_MS
): void {
  // 若同 panelId 重复挂载（reload 场景），覆盖旧的 pending。
  consume(panelId);
  const timer = setTimeout(() => {
    pendingByPanelId.delete(panelId);
    fire();
  }, fallbackMs);
  pendingByPanelId.set(panelId, { fire, timer });
}

export function signalPromptReady(panelId: string): void {
  const entry = consume(panelId);
  if (!entry) return;
  entry.fire();
}

export function cancelPromptReady(panelId: string): void {
  consume(panelId);
}
