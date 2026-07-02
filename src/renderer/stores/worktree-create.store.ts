/**
 * worktree 创建面板状态。渲染由 components/common/worktree-create-host.tsx 承担。
 * 全局单例:重复 open 会顶替未决会话。
 */
import type { GitBranchRef } from "@shared/contracts/git.ts";
import type { WorktreeNameSource } from "@shared/worktree-naming.ts";
import { deriveWorktreeCreation } from "@shared/worktree-naming.ts";
import { toast } from "sonner";
import { create } from "zustand";

const PATH_SEPARATOR_RE = /[\\/]/;

function basename(path: string): string {
  const parts = path.split(PATH_SEPARATOR_RE).filter(Boolean);
  return parts.at(-1) ?? path;
}

export interface WorktreeCreateSession {
  baseBranch: string | null;
  branch: string;
  branchEdited: boolean;
  branches: readonly GitBranchRef[];
  copyPatternCount: number;
  error: string | null;
  existingBranches: readonly string[];
  existingNames: readonly string[];
  input: string;
  mainPath: string;
  name: string;
  phase: "creating" | "idle";
  setupCommand: string;
  source: WorktreeNameSource;
}

interface WorktreeCreateState {
  session: WorktreeCreateSession | null;
}

export const useWorktreeCreateStore = create<WorktreeCreateState>(() => ({
  session: null,
}));

function patchSession(patch: Partial<WorktreeCreateSession>): void {
  const session = useWorktreeCreateStore.getState().session;
  if (!session) {
    return;
  }
  useWorktreeCreateStore.setState({ session: { ...session, ...patch } });
}

function deriveFor(
  session: Pick<
    WorktreeCreateSession,
    "existingBranches" | "existingNames" | "input"
  >,
  branchPrefix: string
): Pick<WorktreeCreateSession, "branch" | "name" | "source"> {
  const draft = deriveWorktreeCreation({
    branchPrefix,
    existingBranches: session.existingBranches,
    existingNames: session.existingNames,
    input: session.input,
  });
  return { branch: draft.branch, name: draft.name, source: draft.source };
}

let activeBranchPrefix = "wt/";

export async function openWorktreeCreatePanel(target: {
  path: string;
}): Promise<void> {
  try {
    const listResult = await window.pier.worktrees.list({
      path: target.path,
    });
    if (listResult.status !== "available") {
      toast.error(listResult.reason);
      return;
    }
    const [branches, preferences] = await Promise.all([
      window.pier.git.listBranches(listResult.mainPath, { kind: "all" }),
      window.pier.preferences.read(),
    ]);
    activeBranchPrefix = preferences.worktreeBranchPrefix;
    const existingBranches = branches.map((ref) => ref.name);
    const existingNames = listResult.worktrees.map((item) =>
      basename(item.path)
    );
    const base = {
      existingBranches,
      existingNames,
      input: "",
    };
    useWorktreeCreateStore.setState({
      session: {
        ...base,
        ...deriveFor(base, activeBranchPrefix),
        baseBranch: null,
        branchEdited: false,
        branches,
        copyPatternCount: preferences.worktreeCopyPatterns.length,
        error: null,
        mainPath: listResult.mainPath,
        phase: "idle",
        setupCommand: preferences.worktreeSetupCommand,
      },
    });
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err));
  }
}

export function updateWorktreeCreateInput(input: string): void {
  const session = useWorktreeCreateStore.getState().session;
  if (!session) {
    return;
  }
  const next = { ...session, error: null, input };
  const derived = next.branchEdited ? {} : deriveFor(next, activeBranchPrefix);
  useWorktreeCreateStore.setState({ session: { ...next, ...derived } });
}

export function setWorktreeCreateBranch(branch: string): void {
  patchSession({ branch, branchEdited: true, error: null });
}

export function setWorktreeCreateBase(baseBranch: string | null): void {
  patchSession({ baseBranch, error: null });
}

export function closeWorktreeCreatePanel(): void {
  useWorktreeCreateStore.setState({ session: null });
}

export async function submitWorktreeCreate(options: {
  start: boolean;
}): Promise<void> {
  const session = useWorktreeCreateStore.getState().session;
  if (!session || session.phase === "creating") {
    return;
  }
  patchSession({ error: null, phase: "creating" });
  try {
    const result = await window.pier.worktrees.create({
      ...(session.baseBranch ? { base: session.baseBranch } : {}),
      branch: session.branch,
      name: session.name,
      path: session.mainPath,
    });
    closeWorktreeCreatePanel();
    toast.success(`${session.branch} · ${result.targetPath}`);
    if (options.start) {
      try {
        const setup = session.setupCommand.trim();
        await window.pier.terminal.open({
          focus: true,
          launch: {
            ...(setup ? { command: setup } : {}),
            cwd: result.targetPath,
          },
        });
      } catch (err) {
        toast.error(
          `终端启动失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  } catch (err) {
    patchSession({
      error: err instanceof Error ? err.message : String(err),
      phase: "idle",
    });
  }
}
