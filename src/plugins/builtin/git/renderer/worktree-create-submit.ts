import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { WorktreeCreatePhase } from "@shared/contracts/worktree.ts";
import {
  type FormValues,
  HEAD_SENTINEL,
  readBranchNamePromptTemplate,
  resolveSubmitDraft,
  type TextFn,
  type WorktreeCreateOverlayData,
} from "./worktree-create-form.tsx";

export type CreateOperationStage = "generating" | WorktreeCreatePhase;

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function currentOperationStage(ref: {
  current: CreateOperationStage;
}): CreateOperationStage {
  return ref.current;
}

async function openWorktreeTerminal(
  context: RendererPluginContext,
  text: TextFn,
  targetPath: string,
  agentId: AgentKind | null,
  options: {
    initialCommand?: string;
    taskPrompt?: string;
    targetGroupId?: string;
  }
): Promise<void> {
  // 非 agent 场景:把 create 返回的 pendingSetupCommand 作为 shell 首输入
  // 自动执行,让 setup 输出对用户可见,用户可自行 Ctrl+C / retry。
  // agent 场景由 taskPrompt 承担,initialCommand 忽略。
  const shellFirst =
    !agentId && options.initialCommand
      ? { initialCommand: options.initialCommand }
      : {};
  const agentPrompt =
    agentId && options.taskPrompt ? { taskPrompt: options.taskPrompt } : {};
  try {
    await context.worktrees.openTerminal({
      ...(agentId ? { agentId } : {}),
      ...shellFirst,
      path: targetPath,
      ...(options.targetGroupId
        ? { targetGroupId: options.targetGroupId }
        : {}),
      ...agentPrompt,
    });
  } catch (err) {
    await context.dialogs.alert({
      body: errorMessage(err),
      title: text("launchFailed", undefined, "Terminal launch failed"),
    });
  }
}

export async function submitWorktreeCreate(options: {
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
  onClose: () => void;
  operationStageRef: { current: CreateOperationStage };
  targetGroupId?: string;
  text: TextFn;
  values: FormValues;
}): Promise<void> {
  const {
    context,
    data,
    onClose,
    operationStageRef,
    targetGroupId,
    text,
    values,
  } = options;

  operationStageRef.current = values.mode === "ai" ? "generating" : "creating";
  onClose();
  const loading = context.notifications.loading(
    values.mode === "ai"
      ? text("generatingBranch", undefined, "Generating branch name…")
      : text("creatingWorktree", undefined, "Creating worktree…")
  );
  try {
    const resolved = await resolveSubmitDraft({
      branchNamePromptTemplate: readBranchNamePromptTemplate(
        context.configuration
      ),
      data,
      generateText: context.ai.generateText,
      text,
      values,
    });
    if ("error" in resolved) {
      loading.dismiss();
      await context.dialogs.alert({
        body: resolved.error,
        title: text(
          "generationFailed",
          undefined,
          "Branch name generation failed"
        ),
      });
      return;
    }
    const { draft } = resolved;
    const agentId =
      values.mode === "ai" && values.startTask && values.agentId !== ""
        ? values.agentId
        : null;
    operationStageRef.current = "creating";
    loading.update(text("creatingWorktree", undefined, "Creating worktree…"));
    const result = await context.worktrees.create(
      {
        ...(values.base === HEAD_SENTINEL ? {} : { base: values.base }),
        branch: draft.branch,
        name: draft.name,
        path: data.mainPath,
        ...(agentId ? { runSetupBeforeReturn: true } : {}),
      },
      {
        onProgress: ({ phase: nextProgressPhase }) => {
          operationStageRef.current = nextProgressPhase;
          loading.update(
            nextProgressPhase === "initializing"
              ? text(
                  "initializingEnvironment",
                  undefined,
                  "Initializing environment…"
                )
              : text("creatingWorktree", undefined, "Creating worktree…")
          );
        },
      }
    );
    // loading 持续到终端 tab 就绪：`context.worktrees.create` 与 `openTerminal`
    // 之间有几十~几百毫秒的 pty spawn 窗口，dismiss 提前会露出空白 workspace，
    // 用户以为流程失败。把 dismiss 挪到终端打开成功/失败之后。
    loading.update(text("openingTerminal", undefined, "Opening terminal…"));
    // agent 存在 → 走 taskPrompt 路径；非 agent 且 create 返回了 pendingSetupCommand
    // → 作为 shell initialCommand 让新终端自动执行 setup。两者互斥。
    try {
      await openWorktreeTerminal(context, text, result.targetPath, agentId, {
        ...(agentId && values.text.trim()
          ? { taskPrompt: values.text.trim() }
          : {}),
        ...(!agentId && result.pendingSetupCommand
          ? { initialCommand: result.pendingSetupCommand }
          : {}),
        ...(targetGroupId ? { targetGroupId } : {}),
      });
    } finally {
      loading.dismiss();
    }
  } catch (err) {
    loading.dismiss();
    const operationStage = currentOperationStage(operationStageRef);
    let failureTitle: string;
    let failureBody: string;
    // git hook 被外部信号杀（典型：macOS 26+ XProtect 首次扫描 hook 慢 → 上游 timeout →
    // SIGKILL 波及 hook）。这不是 Pier 或仓库的错，稍后重试通常就能成功。
    // 由 main 侧 command-router 映射的 code 识别，避免展示技术噪音。
    const errorCode = (err as { code?: string } | null | undefined)?.code;
    if (errorCode === "git_hook_signal_killed") {
      failureTitle = text(
        "hookSignalKilledTitle",
        undefined,
        "系统正在扫描 git hook,操作被中断"
      );
      failureBody = text(
        "hookSignalKilledBody",
        undefined,
        "macOS 首次扫描 git hook 较慢(常见于系统 26+ 首次操作),Pier 中断了当前 git 操作以防挂起。稍后重试通常就能成功——这不是 Pier 或仓库的问题。"
      );
    } else {
      if (operationStage === "generating") {
        failureTitle = text(
          "generationFailed",
          undefined,
          "Branch name generation failed"
        );
      } else if (operationStage === "initializing") {
        failureTitle = text(
          "initializationFailed",
          undefined,
          "Worktree created, but environment initialization failed"
        );
      } else {
        failureTitle = text(
          "createFailed",
          undefined,
          "Worktree creation failed"
        );
      }
      failureBody = errorMessage(err);
    }
    await context.dialogs.alert({
      body: failureBody,
      title: failureTitle,
    });
  }
}
