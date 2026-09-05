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
  /** 只在宿主登记了未决交互时提供；waiting 本身不代表可以远程回应。 */
  pendingInteractionId?: string | undefined;
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
  {
    text: "• Reading tests/unit/main/panel/foreground-activity-transcript-unseal.test.ts",
  },
  { text: "• Ran pnpm vitest run tests/unit/main/panel", tone: "ok" },
  { text: "  ✓ 24 passed (24)", tone: "ok" },
  { text: "" },
  { text: "• Editing tests/unit/main/panel/…transcript-unseal.test.ts" },
  { text: '  + it("unseals on fresh ToolStart after seal", …)', tone: "ok" },
  { text: '  + it("does not unseal on ToolComplete", …)', tone: "ok" },
  { text: "" },
  { text: "• Writing tests/unit/main/panel/turn-state-machine.test.ts" },
  { text: '  + it("keeps sealed turn until fresh ToolStart", …)', tone: "ok" },
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
      body: "智能体想运行 git diff --staged，正在等待你的回应。",
      hostId: HOST_MINI,
      id: "n-waiting",
      read: false,
      sessionId: SESSION_WAITING,
      title: "需要你处理",
      when: "刚刚",
    },
    {
      body: "上一回合已完成。可以打开 xyz 查看当时的输出和后续进展。",
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
      pendingInteractionId: "ix-feat-mobile-read",
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
  | { type: "notification.read"; id: string }
  | { type: "notification.readAll" }
  | { type: "push.set"; state: PushState };

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

/** 与现有 agent.attention.respond 的 13 个键一致；没有选项或语义动作。 */
export const DEMO_RESPONSE_KEYS = [
  "enter",
  "escape",
  "y",
  "n",
  "1",
  "2",
  "3",
  "4",
  "5",
  "6",
  "7",
  "8",
  "9",
] as const;
export type DemoResponseKey = (typeof DEMO_RESPONSE_KEYS)[number];
export type DemoKeyResult = "accepted" | "stale" | "failed";

/** 仅模拟宿主接受按键；不能据此改终端文本、会话状态或生成完成消息。 */
export function demoKeyDelivery(
  session: DemoSession,
  interactionId: string
): DemoKeyResult {
  return session.status === "waiting" &&
    session.pendingInteractionId === interactionId
    ? "accepted"
    : "stale";
}

export function screenText(lines: readonly ScreenLine[]): string {
  return lines.map((line) => line.text).join("\n");
}
