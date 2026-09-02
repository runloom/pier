export interface StartWorkClaim {
  agentId?: string | undefined;
  itemKey: string;
  number: number;
  projectRootPath?: string | undefined;
  repo: string;
  title?: string | undefined;
  url?: string | undefined;
}

export interface WorkOrchestrationDeps {
  check: (request: { path: string }) => Promise<{
    mainPath?: string | undefined;
    status: "supported" | "unsupported";
  }>;
  create: (request: {
    branch: string;
    name: string;
    path: string;
    runSetupBeforeReturn: boolean;
  }) => Promise<{ targetPath: string }>;
  openTerminal: (request: {
    agentId?: string | undefined;
    path: string;
    taskPrompt: string;
  }) => Promise<{ panelId: string }>;
  recordOverlay: (overlay: {
    createdAt: number;
    itemKey: string;
    panelId: string;
    worktreePath: string;
  }) => Promise<void>;
  remove: (request: { path: string }) => Promise<unknown>;
}

export interface WorkOrchestrationResult {
  createdWorktree: boolean;
  openedTerminal: boolean;
  overlayRecorded: boolean;
  panelId?: string;
  worktreePath?: string;
}

export function buildTaskPrompt(claim: StartWorkClaim): string {
  const lines = [
    `Work on ${claim.itemKey}: ${claim.title ?? claim.itemKey}.`,
    claim.url ? `Issue: ${claim.url}` : null,
    "Claim this task, keep the linked pull request in scope, and stop when checks pass.",
  ];
  return lines.filter((line): line is string => Boolean(line)).join("\n");
}

export async function orchestrateStartWork(
  deps: WorkOrchestrationDeps,
  claim: StartWorkClaim
): Promise<WorkOrchestrationResult> {
  const projectRootPath = claim.projectRootPath;
  if (!projectRootPath) {
    throw new Error("missing project path");
  }
  const checked = await deps.check({ path: projectRootPath });
  if (checked.status !== "supported" || !checked.mainPath) {
    throw new Error("this folder does not support extra working trees");
  }
  const name = `task-${claim.number}`;
  const branch = `pier/task-${claim.number}`;
  let worktreePath: string | undefined;
  try {
    const created = await deps.create({
      branch,
      name,
      path: checked.mainPath,
      runSetupBeforeReturn: true,
    });
    worktreePath = created.targetPath;
    const terminal = await deps.openTerminal({
      ...(claim.agentId ? { agentId: claim.agentId } : {}),
      path: created.targetPath,
      taskPrompt: buildTaskPrompt(claim),
    });
    await deps.recordOverlay({
      createdAt: Date.now(),
      itemKey: claim.itemKey,
      panelId: terminal.panelId,
      worktreePath: created.targetPath,
    });
    return {
      createdWorktree: true,
      openedTerminal: true,
      overlayRecorded: true,
      panelId: terminal.panelId,
      worktreePath: created.targetPath,
    };
  } catch (error) {
    if (worktreePath) {
      await deps.remove({ path: worktreePath }).catch(() => undefined);
    }
    throw error;
  }
}
