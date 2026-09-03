/**
 * 画板示范数据与可点原型的状态机。
 *
 * 只描述「这台电脑上有什么」：主机、会话、收件箱、git 变更、工作树文件。
 * 标题对齐桌面 tab short（叶子目录 / 钉名），不是产品 id；时间用相对文案，
 * 画板不需要时钟。静态帧读 `INITIAL_DEMO`，P0 原型经 `reduceDemo` 改它。
 */

export type HostReach = "lan" | "relay";
export type HostStatus = "online" | "offline" | "unknown";
export type DeviceKind = "mini" | "studio" | "laptop";

export interface DemoHost {
  id: string;
  name: string;
  device: DeviceKind;
  reach: HostReach;
  status: HostStatus;
  /** 副标题：局域网地址或远程说明。 */
  detail: string;
}

export type SessionStatus = "waiting" | "processing" | "ready";

export interface ScreenLine {
  text: string;
  tone?: "prompt" | "dim" | "warn" | "ok" | "accent";
}

export interface DemoSession {
  id: string;
  hostId: string;
  /** 桌面 tab short：叶子目录或用户钉名。 */
  title: string;
  kind: "agent" | "terminal";
  agent?: string;
  status: SessionStatus;
  /** 工作树叶子名，进变更 / 文件时作为作用域标题。 */
  worktree: string;
  /** 会话目录属于 git 仓库时才出现「变更」入口（与桌面一致）。 */
  hasGit: boolean;
  /** 工作台大卡摘要：等待时是审批问句，运行中是正在做什么。 */
  ask?: string;
  screen: ScreenLine[];
}

export interface DemoNotification {
  id: string;
  hostId: string;
  title: string;
  body: string;
  when: string;
  read: boolean;
  sessionId: string | null;
}

export type ChangeLetter = "M" | "A" | "D" | "?";

export interface DiffLine {
  kind: "add" | "del" | "ctx" | "meta";
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
}

export interface DemoChange {
  path: string;
  letter: ChangeLetter;
  added: number;
  removed: number;
  hunks: DiffHunk[];
}

export interface DemoFileEntry {
  name: string;
  kind: "dir" | "file";
  size?: string;
}

export type PushState = "idle" | "busy" | "done";

export interface DemoState {
  hosts: DemoHost[];
  sessions: DemoSession[];
  notifications: DemoNotification[];
  push: PushState;
}

/** 画板与测试共用的固定文案。 */
export const DEMO = {
  branch: "feat/mobile-20260901",
  changesLabel: "变更 · feat-mobile",
  hostOnline: "办公桌 Mac mini",
  hostOffline: "工作室 Mac Studio",
  pairedHostName: "MacBook Pro",
  runningTitle: "xyz",
  terminalTitle: "ghostty",
  waitingTitle: "feat-mobile",
  worktree: "feat-mobile",
} as const;

export const HOST_MINI = "host-mini";
export const HOST_STUDIO = "host-studio";
export const SESSION_WAITING = "s-feat-mobile";
export const SESSION_RUNNING = "s-xyz";
export const SESSION_TERMINAL = "s-ghostty";

const WAITING_SCREEN: ScreenLine[] = [
  { text: "❯ claude", tone: "prompt" },
  { text: "" },
  { text: "● Read src/renderer/app.tsx", tone: "dim" },
  { text: "● Read apps/mobile-web/src/lib/session.ts", tone: "dim" },
  { text: "● Bash(git status --short)", tone: "dim" },
  { text: "  ⎿  M  apps/mobile-web/src/app.tsx", tone: "dim" },
  { text: "     A  …/connection-banner.tsx", tone: "dim" },
  { text: "" },
  { text: "● Bash(git diff --staged)" },
  { text: "  ⎿  Waiting for permission…", tone: "dim" },
  { text: "" },
  { text: "Do you want to proceed?" },
  { text: "❯ 1. Yes", tone: "accent" },
  { text: "  2. Yes, don't ask again", tone: "dim" },
  { text: "  3. No", tone: "dim" },
];

const RUNNING_SCREEN: ScreenLine[] = [
  { text: "❯ codex", tone: "prompt" },
  { text: "" },
  { text: "› 把 foreground-activity 的四态聚合补上单测", tone: "dim" },
  { text: "" },
  { text: "• Reading src/main/services/foreground-activity/" },
  { text: "• Reading src/shared/contracts/foreground-activity.ts" },
  { text: "• Reading tests/unit/main/panel/turn-state-machine.test.ts" },
  { text: "• Reading tests/unit/main/panel/foreground-activity-transcript-unseal.test.ts" },
  { text: "• Ran pnpm vitest run tests/unit/main/panel", tone: "ok" },
  { text: "  ✓ 24 passed (24)", tone: "ok" },
  { text: "" },
  { text: "• Editing tests/unit/main/panel/…transcript-unseal.test.ts" },
  { text: "  + it(\"unseals on fresh ToolStart after seal\", …)", tone: "ok" },
  { text: "  + it(\"does not unseal on ToolComplete\", …)", tone: "ok" },
  { text: "" },
  { text: "• Writing tests/unit/main/panel/turn-state-machine.test.ts" },
  { text: "  + it(\"keeps sealed turn until fresh ToolStart\", …)", tone: "ok" },
  { text: "" },
  { text: "▌ Thinking… (12s)", tone: "accent" },
];

const TERMINAL_SCREEN: ScreenLine[] = [
  { text: "~/dev/ghostty on  main [!?]", tone: "dim" },
  { text: "❯ zig build -Doptimize=ReleaseFast", tone: "prompt" },
  { text: "  [326/1180] compiling src/terminal/Screen.zig…" },
  { text: "  [712/1180] compiling src/renderer/Metal.zig…" },
  { text: "  [1180/1180] linking ghostty", tone: "ok" },
  { text: "  Build Summary: 1180/1180 steps succeeded", tone: "ok" },
  { text: "" },
  { text: "~/dev/ghostty on  main [!?]", tone: "dim" },
  { text: "❯ ./zig-out/bin/ghostty +version", tone: "prompt" },
  { text: "  Ghostty 1.2.0-dev+abc1234" },
  { text: "  libghostty 1.2.0", tone: "dim" },
  { text: "" },
  { text: "~/dev/ghostty on  main [!?]", tone: "dim" },
  { text: "❯ ", tone: "prompt" },
];

/** 审批键回写后，终端继续跑；画面用同一条命令的执行结果。 */
function respondedScreen(key: string): ScreenLine[] {
  const declined = key === "Esc" || key === "n" || key === "3";
  if (declined) {
    return [
      { text: "❯ claude", tone: "prompt" },
      { text: "" },
      { text: "● Bash(git diff --staged)" },
      { text: "  ⎿  Permission denied by user", tone: "warn" },
      { text: "" },
      { text: "● 好，我不再直接读暂存区，改为让你在电脑上" },
      { text: "  运行 `git diff --staged` 后把要点告诉我。" },
      { text: "" },
      { text: "▌ 等待你的输入…", tone: "accent" },
    ];
  }
  return [
    { text: "❯ claude", tone: "prompt" },
    { text: "" },
    { text: "● Bash(git diff --staged)" },
    { text: "  ⎿  diff --git a/apps/mobile-web/src/app.tsx", tone: "dim" },
    { text: "     +import { ConnectionBanner } from …", tone: "ok" },
    { text: "     … 3 files changed, 116 insertions(+), 7 deletions(-)", tone: "dim" },
    { text: "" },
    { text: "● 暂存区里是连接横幅和它的单测。我先跑一遍" },
    { text: "  mobile-web 的单测，再帮你整理提交说明。" },
    { text: "" },
    { text: "● Bash(pnpm vitest run tests/unit/mobile-web)" },
    { text: "  ⎿  Running…", tone: "accent" },
  ];
}

const FINISHED_SCREEN: ScreenLine[] = [
  { text: "❯ claude", tone: "prompt" },
  { text: "" },
  { text: "● Bash(pnpm vitest run tests/unit/mobile-web)" },
  { text: "  ⎿  Test Files  18 passed (18)", tone: "ok" },
  { text: "         Tests  131 passed (131)", tone: "ok" },
  { text: "      Duration  6.4s", tone: "dim" },
  { text: "" },
  { text: "● 单测全绿。提交说明建议：" },
  { text: "  feat(mobile-web): 连接横幅明示断线与重连" },
  { text: "" },
  { text: "  要我现在提交吗？（我会先给你看 diff --staged）" },
  { text: "" },
  { text: "▌ 等待你的输入…", tone: "accent" },
];

export const INITIAL_DEMO: DemoState = {
  hosts: [
    {
      detail: "局域网",
      device: "mini",
      id: HOST_MINI,
      name: DEMO.hostOnline,
      reach: "lan",
      status: "online",
    },
    {
      detail: "远程 · 未开机",
      device: "studio",
      id: HOST_STUDIO,
      name: DEMO.hostOffline,
      reach: "relay",
      status: "offline",
    },
  ],
  notifications: [
    {
      body: "feat-mobile 在等你确认一条命令，点按打开该会话",
      hostId: HOST_MINI,
      id: "n-waiting",
      read: false,
      sessionId: SESSION_WAITING,
      title: "需要你处理",
      when: "刚刚",
    },
    {
      body: "xyz 已停在当前屏幕",
      hostId: HOST_MINI,
      id: "n-finished",
      read: true,
      sessionId: SESSION_RUNNING,
      title: "回合已完成",
      when: "12 分钟前",
    },
    {
      body: "这台电脑现在可以从外网连接",
      hostId: HOST_MINI,
      id: "n-remote",
      read: true,
      sessionId: null,
      title: "远程访问已开启",
      when: "昨天",
    },
  ],
  push: "idle",
  sessions: [
    {
      agent: "Claude Code",
      ask: "Bash · git diff --staged",
      hasGit: true,
      hostId: HOST_MINI,
      id: SESSION_WAITING,
      kind: "agent",
      screen: WAITING_SCREEN,
      status: "waiting",
      title: DEMO.waitingTitle,
      worktree: DEMO.worktree,
    },
    {
      agent: "Codex",
      ask: "正在补 foreground-activity 单测",
      hasGit: true,
      hostId: HOST_MINI,
      id: SESSION_RUNNING,
      kind: "agent",
      screen: RUNNING_SCREEN,
      status: "processing",
      title: DEMO.runningTitle,
      worktree: "xyz",
    },
    {
      hasGit: true,
      hostId: HOST_MINI,
      id: SESSION_TERMINAL,
      kind: "terminal",
      screen: TERMINAL_SCREEN,
      status: "ready",
      title: DEMO.terminalTitle,
      worktree: "ghostty",
    },
  ],
};

/** 配对成功后加入列表的那台电脑。 */
export const PAIRED_HOST: DemoHost = {
  detail: "远程 · 刚配对",
  device: "laptop",
  id: "host-mbp",
  name: DEMO.pairedHostName,
  reach: "relay",
  status: "online",
};

export type DemoAction =
  | { type: "host.add"; host: DemoHost }
  | { type: "host.remove"; hostId: string }
  | { type: "session.respond"; sessionId: string; key: string }
  | { type: "session.turnFinished"; sessionId: string }
  | { type: "notification.read"; id: string }
  | { type: "notification.readAll" }
  | { type: "push.set"; state: PushState };

let notificationSeq = 0;

export function reduceDemo(state: DemoState, action: DemoAction): DemoState {
  switch (action.type) {
    case "host.add":
      return state.hosts.some((host) => host.id === action.host.id)
        ? state
        : { ...state, hosts: [...state.hosts, action.host] };
    case "host.remove":
      return {
        ...state,
        hosts: state.hosts.filter((host) => host.id !== action.hostId),
      };
    case "session.respond":
      return {
        ...state,
        notifications: state.notifications.map((item) =>
          item.sessionId === action.sessionId ? { ...item, read: true } : item
        ),
        sessions: state.sessions.map((session) =>
          session.id === action.sessionId
            ? {
                ...session,
                screen: respondedScreen(action.key),
                status: "processing",
              }
            : session
        ),
      };
    case "session.turnFinished": {
      const session = state.sessions.find(
        (item) => item.id === action.sessionId
      );
      if (session === undefined || session.status !== "processing") {
        return state;
      }
      notificationSeq += 1;
      return {
        ...state,
        notifications: [
          {
            body: `${session.title} 已停在当前屏幕，等你下一步`,
            hostId: session.hostId,
            id: `n-turn-${notificationSeq}`,
            read: false,
            sessionId: session.id,
            title: "回合已完成",
            when: "刚刚",
          },
          ...state.notifications,
        ],
        sessions: state.sessions.map((item) =>
          item.id === session.id
            ? { ...item, screen: FINISHED_SCREEN, status: "ready" }
            : item
        ),
      };
    }
    case "notification.read":
      return {
        ...state,
        notifications: state.notifications.map((item) =>
          item.id === action.id ? { ...item, read: true } : item
        ),
      };
    case "notification.readAll":
      return {
        ...state,
        notifications: state.notifications.map((item) =>
          item.read ? item : { ...item, read: true }
        ),
      };
    case "push.set":
      return { ...state, push: action.state };
    default:
      return state;
  }
}

export function notificationsOf(
  state: DemoState,
  hostId: string
): DemoNotification[] {
  return state.notifications.filter((item) => item.hostId === hostId);
}

export function unreadCount(
  items: readonly Pick<DemoNotification, "read">[]
): number {
  return items.filter((item) => !item.read).length;
}

export function sessionsOf(state: DemoState, hostId: string): DemoSession[] {
  const list = state.sessions.filter((session) => session.hostId === hostId);
  // 需要你处理置顶；其余保持原顺序。
  return [
    ...list.filter((session) => session.status === "waiting"),
    ...list.filter((session) => session.status !== "waiting"),
  ];
}

export interface InboxThread {
  key: string;
  latest: DemoNotification;
  sessionId: string | null;
  title: string;
  unread: boolean;
  waiting: boolean;
}

/**
 * 收件箱按会话收成一行：新事件更新同一行，需要你处理钉顶。
 * 没有会话身份的主机消息单独成行，排在后面。
 */
export function inboxThreads(
  items: readonly DemoNotification[],
  sessions: readonly DemoSession[]
): InboxThread[] {
  const bySession = new Map<string, DemoNotification[]>();
  const hostLevel: DemoNotification[] = [];
  for (const item of items) {
    if (item.sessionId === null) {
      hostLevel.push(item);
      continue;
    }
    const list = bySession.get(item.sessionId) ?? [];
    list.push(item);
    bySession.set(item.sessionId, list);
  }
  const threads: InboxThread[] = [];
  for (const [sessionId, list] of bySession) {
    const latest = list[0];
    if (latest === undefined) {
      continue;
    }
    const session = sessions.find((item) => item.id === sessionId);
    threads.push({
      key: sessionId,
      latest,
      sessionId,
      title: session?.title ?? latest.title,
      unread: list.some((item) => !item.read),
      waiting: session?.status === "waiting",
    });
  }
  for (const item of hostLevel) {
    threads.push({
      key: item.id,
      latest: item,
      sessionId: null,
      title: item.title,
      unread: !item.read,
      waiting: false,
    });
  }
  return [
    ...threads.filter((thread) => thread.waiting),
    ...threads.filter((thread) => !thread.waiting && thread.unread),
    ...threads.filter((thread) => !(thread.waiting || thread.unread)),
  ];
}
