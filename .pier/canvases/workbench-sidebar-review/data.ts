export type GitChangeSummary =
  | {
      kind: "lineDelta";
      changedFiles: number;
      insertions: number;
      deletions: number;
      excludedFiles: number;
    }
  | {
      kind: "filesOnly";
      changedFiles: number;
      omittedFiles: number;
      reasons: string[];
    };

export type ActivityStatus = "attention" | "running" | "idle";

export interface Session {
  agentId: "codex" | "claude" | "gemini" | null;
  id: string;
  status: ActivityStatus;
  title: string;
  unread?: boolean;
  windowLabel?: string;
}

export interface Worktree {
  branch?: string;
  identity: 1 | 2 | 3 | 4 | 5 | 6;
  isMain?: boolean;
  key: string;
  name: string;
  path: string;
  project: string;
  sessions: Session[];
  status: ActivityStatus;
  summary?: GitChangeSummary;
}

export interface Project {
  id: string;
  name: string;
  worktrees: Worktree[];
}

export const DEMO_PROJECTS: Project[] = [
  {
    id: "pier",
    name: "pier",
    worktrees: [
      {
        key: "demo:local:/Users/demo/Projects/pier",
        name: "pier",
        path: "/Users/demo/Projects/pier",
        project: "pier",
        identity: 1,
        isMain: true,
        branch: "main",
        status: "attention",
        summary: {
          kind: "lineDelta",
          changedFiles: 4,
          insertions: 42,
          deletions: 9,
          excludedFiles: 0,
        },
        sessions: [
          {
            id: "demo:pier:codex",
            title: "codex",
            agentId: "codex",
            status: "attention",
          },
          {
            id: "demo:pier:dev",
            title: "pnpm dev",
            agentId: null,
            status: "running",
          },
        ],
      },
      {
        key: "demo:local:/Users/demo/Worktrees/pier/sidebar-switching",
        name: "sidebar-switching",
        path: "/Users/demo/Worktrees/pier/sidebar-switching",
        project: "pier",
        identity: 2,
        branch: "feat/sidebar-switching",
        status: "idle",
        summary: {
          kind: "lineDelta",
          changedFiles: 8,
          insertions: 186,
          deletions: 34,
          excludedFiles: 0,
        },
        sessions: [
          {
            id: "demo:sidebar-switching:claude",
            title: "claude",
            agentId: "claude",
            status: "idle",
            unread: true,
          },
          {
            id: "demo:sidebar-switching:gemini",
            title: "gemini",
            agentId: "gemini",
            status: "idle",
            unread: true,
          },
        ],
      },
      {
        key: "demo:local:/Users/demo/Worktrees/pier/review-layout",
        name: "review-layout",
        path: "/Users/demo/Worktrees/pier/review-layout",
        project: "pier",
        identity: 3,
        branch: "feat/review-layout",
        status: "running",
        summary: {
          kind: "filesOnly",
          changedFiles: 3,
          omittedFiles: 3,
          reasons: ["tooLarge"],
        },
        sessions: [
          {
            id: "demo:review-layout:claude",
            title: "claude",
            agentId: "claude",
            status: "running",
            windowLabel: "review-layout · +1 · pier",
          },
        ],
      },
    ],
  },
  {
    id: "harbor",
    name: "harbor",
    worktrees: [
      {
        key: "demo:local:/Users/demo/Projects/harbor",
        name: "harbor",
        path: "/Users/demo/Projects/harbor",
        project: "harbor",
        identity: 4,
        isMain: true,
        branch: "main",
        status: "running",
        summary: {
          kind: "lineDelta",
          changedFiles: 2,
          insertions: 18,
          deletions: 6,
          excludedFiles: 0,
        },
        sessions: [
          {
            id: "demo:harbor:dev",
            title: "pnpm dev",
            agentId: null,
            status: "running",
          },
        ],
      },
      {
        key: "demo:local:/Users/demo/Worktrees/harbor/notification-accessibility-review",
        name: "notification-accessibility-review",
        path: "/Users/demo/Worktrees/harbor/notification-accessibility-review",
        project: "harbor",
        identity: 5,
        branch: "feat/notification-a11y",
        status: "idle",
        sessions: [],
      },
    ],
  },
];

export const DEMO_LOCAL_DIRECTORIES: Worktree[] = [
  {
    key: "demo:local:/Users/demo/Notes",
    name: "Notes",
    path: "/Users/demo/Notes",
    project: "local-directories",
    identity: 6,
    status: "idle",
    sessions: [
      {
        id: "demo:notes:terminal",
        title: "Terminal",
        agentId: null,
        status: "idle",
      },
    ],
  },
];

export const DEMO_REMOTE_HOST = "devbox";

export const DEMO_REMOTE_PROJECTS: Project[] = [
  {
    id: "devbox:harbor-api",
    name: "harbor-api",
    worktrees: [
      {
        key: "demo:ssh:devbox:/home/demo/Projects/harbor-api",
        name: "harbor-api",
        path: "/home/demo/Projects/harbor-api",
        project: "devbox:harbor-api",
        identity: 6,
        isMain: true,
        branch: "main",
        status: "running",
        summary: {
          kind: "lineDelta",
          changedFiles: 1,
          insertions: 12,
          deletions: 3,
          excludedFiles: 0,
        },
        sessions: [
          {
            id: "demo:devbox:harbor-api:codex",
            title: "codex",
            agentId: "codex",
            status: "running",
          },
        ],
      },
    ],
  },
];
