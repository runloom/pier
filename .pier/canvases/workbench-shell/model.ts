/**
 * 示例数据 —— 只服务设计稿，不代表任何真实仓库。
 * 对象与状态词汇对齐 docs/superpowers/specs/2026-09-07-workbench-worktree-tiles-design.md §4 / §7。
 */

export type IdentityId = 1 | 2 | 3 | 4 | 5 | 6;

export type SessionState = "needsYou" | "running" | "doneUnseen" | "idle";

export interface DemoSession {
  readonly id: string;
  readonly provider: "Codex" | "Claude" | "OpenCode" | "shell";
  readonly title: string;
  readonly state: SessionState;
  /** 会话所在窗口的 menuLabel；本窗省略。 */
  readonly window?: string;
  readonly lines: readonly DemoLine[];
}

export interface DemoLine {
  readonly kind: "agent" | "input" | "out" | "prompt";
  readonly text: string;
}

export interface DemoWorktree {
  readonly id: string;
  readonly name: string;
  readonly branch?: string;
  readonly changes?: number;
  readonly ahead?: number;
  readonly behind?: number;
  readonly identity: IdentityId;
  readonly sessions: readonly DemoSession[];
  readonly main?: boolean;
}

export interface DemoProject {
  readonly id: string;
  readonly name: string;
  readonly mainBranch?: string;
  readonly worktrees: readonly DemoWorktree[];
}

/** 工作区级插件目的地：和「项目」树平级，不按项目复制。 */
export interface DemoDestination {
  readonly id: string;
  readonly title: string;
}

export const SIDEBAR_DESTINATIONS: readonly DemoDestination[] = [{ id: "pier.tasks.board", title: "任务" }];

const LOGIN_LINES: readonly DemoLine[] = [
  { kind: "prompt", text: "❯ codex" },
  { kind: "out", text: "› 修复登录超时，并补充回归测试。" },
  { kind: "agent", text: "已调整 refresh() 的重试逻辑，并新增 session.test.ts。" },
  { kind: "agent", text: "测试通过（31 passed）。请检查更改；是否同时更新 docs/auth.md？" },
  { kind: "input", text: "输入下一步…" },
];

const BILLING_LINES: readonly DemoLine[] = [
  { kind: "prompt", text: "❯ claude" },
  { kind: "out", text: "› 按地区解析税率，避免硬编码 0.2。" },
  { kind: "agent", text: "正在运行 pnpm test src/billing …" },
  { kind: "out", text: "  ✓ tax.test.ts (18)   ⠧ invoice.test.ts" },
];

const NOTES_LINES: readonly DemoLine[] = [
  { kind: "prompt", text: "❯ opencode" },
  { kind: "out", text: "› 把本周会议纪要整理成周报。" },
  { kind: "agent", text: "已写入 weekly/2026-09-07.md，共 6 条要点。" },
  { kind: "out", text: "  回合已结束" },
];

const DEV_LINES: readonly DemoLine[] = [
  { kind: "prompt", text: "❯ pnpm dev" },
  { kind: "out", text: "  electron-vite v5  dev server running" },
  { kind: "out", text: "  main      ✓ built in 412ms" },
  { kind: "out", text: "  renderer  http://localhost:5173/" },
];

const RELAY_LINES: readonly DemoLine[] = [
  { kind: "prompt", text: "❯ codex" },
  { kind: "out", text: "› 给 relay 加连接数指标。" },
  { kind: "agent", text: "已添加 /metrics，等待你确认埋点命名。" },
];

export const PROJECTS: readonly DemoProject[] = [
  {
    id: "pier",
    mainBranch: "main",
    name: "pier",
    worktrees: [
      {
        ahead: 1,
        branch: "fix/login",
        changes: 12,
        id: "pier-login",
        identity: 1,
        name: "pier-login",
        sessions: [
          { id: "s-login", lines: LOGIN_LINES, provider: "Codex", state: "needsYou", title: "登录超时" },
        ],
      },
      {
        behind: 2,
        branch: "feat/billing",
        changes: 3,
        id: "pier-billing",
        identity: 2,
        name: "pier-billing",
        sessions: [
          { id: "s-billing", lines: BILLING_LINES, provider: "Claude", state: "running", title: "账单税率" },
        ],
      },
      {
        branch: "main",
        id: "pier-main",
        identity: 6,
        main: true,
        name: "pier",
        sessions: [{ id: "s-dev", lines: DEV_LINES, provider: "shell", state: "idle", title: "pnpm dev" }],
      },
    ],
  },
  {
    id: "notes",
    name: "notes",
    worktrees: [
      {
        id: "notes",
        identity: 3,
        name: "notes",
        sessions: [
          { id: "s-notes", lines: NOTES_LINES, provider: "OpenCode", state: "doneUnseen", title: "周报整理" },
        ],
      },
    ],
  },
  {
    id: "relay",
    mainBranch: "main",
    name: "relay",
    worktrees: [
      {
        branch: "main",
        id: "relay-main",
        identity: 4,
        main: true,
        name: "relay",
        sessions: [
          {
            id: "s-relay",
            lines: RELAY_LINES,
            provider: "Codex",
            state: "needsYou",
            title: "连接数指标",
            window: "relay",
          },
        ],
      },
    ],
  },
];

export const RECENTS: readonly string[] = ["~/work/mobile-web", "~/work/docs-site"];

export const STATE_META: Record<SessionState, { readonly dot: string; readonly label: string; readonly text: string }> = {
  doneUnseen: { dot: "", label: "已完成，你还没有查看", text: "text-foreground" },
  idle: { dot: "bg-status-neutral-fg", label: "空闲", text: "text-status-neutral-fg" },
  needsYou: { dot: "bg-status-warning-fg", label: "需要你处理", text: "text-status-warning-fg" },
  running: { dot: "bg-status-info-fg", label: "运行中", text: "text-status-info-fg" },
};

/** 聚合只取三值（需要你处理 > 运行中 > 空闲）；完成未查看只加粗。 */
export type AggregateState = "needsYou" | "running" | "idle";

const RANK: Record<AggregateState, number> = { idle: 2, needsYou: 0, running: 1 };

export function aggregate(states: readonly SessionState[]): AggregateState | undefined {
  let best: AggregateState | undefined;
  for (const state of states) {
    const value: AggregateState = state === "doneUnseen" ? "idle" : state;
    if (best === undefined || RANK[value] < RANK[best]) {
      best = value;
    }
  }
  return best === "idle" ? undefined : best;
}

export function worktreeState(tree: DemoWorktree): AggregateState | undefined {
  return aggregate(tree.sessions.map((session) => session.state));
}

export function worktreeUnseen(tree: DemoWorktree): boolean {
  return tree.sessions.some((session) => session.state === "doneUnseen");
}

export function projectState(project: DemoProject): AggregateState | undefined {
  return aggregate(project.worktrees.flatMap((tree) => tree.sessions.map((session) => session.state)));
}

export function workspaceCounts(projects: readonly DemoProject[]): { readonly needsYou: number; readonly running: number } {
  let needsYou = 0;
  let running = 0;
  for (const project of projects) {
    for (const tree of project.worktrees) {
      for (const session of tree.sessions) {
        if (session.state === "needsYou") {
          needsYou += 1;
        } else if (session.state === "running") {
          running += 1;
        }
      }
    }
  }
  return { needsYou, running };
}

export function findWorktree(id: string): DemoWorktree {
  for (const project of PROJECTS) {
    const hit = project.worktrees.find((tree) => tree.id === id);
    if (hit) {
      return hit;
    }
  }
  throw new Error(`demo worktree missing: ${id}`);
}

/** `--identity-N` 在画板脱离宿主时的回退。 */
const IDENTITY_FALLBACK: Record<IdentityId, string> = {
  1: "oklch(0.6 0.09 205)",
  2: "oklch(0.58 0.1 285)",
  3: "oklch(0.6 0.1 345)",
  4: "oklch(0.58 0.08 100)",
  5: "oklch(0.6 0.09 180)",
  6: "oklch(0.58 0.1 315)",
};

export function identityColor(id: IdentityId): string {
  return `var(--identity-${id}, ${IDENTITY_FALLBACK[id]})`;
}
