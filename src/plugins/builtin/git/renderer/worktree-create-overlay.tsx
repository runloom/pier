import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@pier/ui/button.tsx";
import { Field, FieldGroup, FieldLabel } from "@pier/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type {
  RendererPluginAgentSelection,
  RendererPluginContentDialogRenderProps,
  RendererPluginContext,
} from "@plugins/api/renderer.ts";
import type { AgentKind } from "@shared/contracts/agent.ts";
import type { WorktreeCreatePhase } from "@shared/contracts/worktree.ts";
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
} from "@shared/worktree-naming.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  buildFormSchema,
  type CreateMode,
  type FormValues,
  HEAD_SENTINEL,
  PrepareBadges,
  readBranchNamePromptTemplate,
  resolveSubmitDraft,
  type WorktreeCreateOverlayData,
} from "./worktree-create-form.tsx";
import {
  AiModeFields,
  CustomModeField,
} from "./worktree-create-mode-fields.tsx";

export type { WorktreeCreateOverlayData } from "./worktree-create-form.tsx";

interface WorktreeCreateOverlayProps {
  close: RendererPluginContentDialogRenderProps["close"];
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
  targetGroupId?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

type CreateOperationStage = "generating" | WorktreeCreatePhase;

function currentOperationStage(ref: {
  current: CreateOperationStage;
}): CreateOperationStage {
  return ref.current;
}

function focusActiveModeInput(mode: CreateMode): void {
  const target = document.getElementById(
    mode === "ai" ? "worktree-create-task" : "worktree-create-branch"
  );
  if (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  ) {
    target.focus({ preventScroll: true });
  }
}

function WorktreeCreateOverlay({
  close,
  context,
  data,
  targetGroupId,
}: WorktreeCreateOverlayProps) {
  const [agentSelection, setAgentSelection] =
    useState<RendererPluginAgentSelection | null>(null);
  const operationStageRef = useRef<CreateOperationStage>("creating");
  const submittedRef = useRef(false);

  const text = useCallback(
    (
      key: string,
      values: Record<string, number | string> | undefined,
      fallback: string
    ): string => context.i18n.t(`ui.worktreeCreate.${key}`, values, fallback),
    [context.i18n]
  );

  const schema = useMemo(
    () => buildFormSchema(data.existingBranches, text),
    [data.existingBranches, text]
  );

  const form = useForm<FormValues>({
    defaultValues: {
      agentId: "",
      base: HEAD_SENTINEL,
      branch: "",
      mode: "ai",
      startTask: false,
      text: "",
    },
    resolver: zodResolver(schema),
  });
  const mode = form.watch("mode");
  const branchValue = form.watch("branch");

  useEffect(() => {
    focusActiveModeInput(mode);
  }, [mode]);

  useEffect(() => {
    let disposed = false;
    context.ai
      .status()
      .then((status) => {
        if (disposed) {
          return;
        }
        if (!status.configured) {
          form.setValue("mode", "custom");
        }
      })
      .catch(() => {
        if (!disposed) {
          form.setValue("mode", "custom");
        }
      });
    return () => {
      disposed = true;
    };
  }, [context.ai, form]);

  useEffect(() => {
    let disposed = false;
    context.agents
      .selection()
      .then((selection) => {
        if (disposed) {
          return;
        }
        setAgentSelection(selection);
        if (selection.selectedId && form.getValues("agentId") === "") {
          form.setValue("agentId", selection.selectedId);
        }
      })
      .catch(() => {
        if (!disposed) {
          setAgentSelection({
            detectedIds: [],
            enabledIds: [],
            rankedIds: [],
            selectedId: null,
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [context.agents, form]);

  const customDraft = useMemo<WorktreeCreationDraft | null>(() => {
    const branch = branchValue.trim();
    if (!(branch && sanitizeWorktreeName(branch))) {
      return null;
    }
    return deriveWorktreeCreation({
      existingBranches: data.existingBranches,
      existingNames: data.existingNames,
      input: branch,
    });
  }, [branchValue, data]);

  const agentSelectionLoaded = agentSelection !== null;

  function closeOverlay(): void {
    close();
  }

  async function openWorktreeTerminal(
    targetPath: string,
    agentId: AgentKind | null,
    options: {
      initialCommand?: string;
      taskPrompt?: string;
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
        ...(targetGroupId ? { targetGroupId } : {}),
        ...agentPrompt,
      });
    } catch (err) {
      await context.dialogs.alert({
        body: errorMessage(err),
        title: text("launchFailed", undefined, "Terminal launch failed"),
      });
    }
  }

  async function onSubmit(values: FormValues): Promise<void> {
    if (submittedRef.current) {
      return;
    }
    submittedRef.current = true;
    operationStageRef.current =
      values.mode === "ai" ? "generating" : "creating";
    closeOverlay();
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
        await openWorktreeTerminal(result.targetPath, agentId, {
          ...(agentId && values.text.trim()
            ? { taskPrompt: values.text.trim() }
            : {}),
          ...(!agentId && result.pendingSetupCommand
            ? { initialCommand: result.pendingSetupCommand }
            : {}),
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

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FieldGroup className="gap-4">
        <Tabs
          onValueChange={(value) => {
            form.setValue("mode", value as CreateMode);
            form.clearErrors();
          }}
          value={mode}
        >
          <TabsList className="w-full">
            <TabsTrigger value="ai">
              {text("modeAi", undefined, "Smart generation")}
            </TabsTrigger>
            <TabsTrigger value="custom">
              {text("modeCustom", undefined, "Manual naming")}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {mode === "ai" ? (
          <AiModeFields
            agentSelection={agentSelection}
            agentSelectionLoaded={agentSelectionLoaded}
            form={form}
            onSubmit={onSubmit}
            rootPath={data.defaults.rootPath}
            text={text}
          />
        ) : (
          <CustomModeField
            customDraft={customDraft}
            form={form}
            rootPath={data.defaults.rootPath}
            text={text}
          />
        )}

        <Field>
          <FieldLabel htmlFor="worktree-create-base">
            {text("baseLabel", undefined, "Base")}
          </FieldLabel>
          <Controller
            control={form.control}
            name="base"
            render={({ field }) => (
              <Select onValueChange={field.onChange} value={field.value}>
                <SelectTrigger className="font-mono" id="worktree-create-base">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value={HEAD_SENTINEL}>
                      {text("baseHead", undefined, "Current HEAD")}
                    </SelectItem>
                    {data.branches.map((ref) => (
                      <SelectItem
                        key={`${ref.kind}:${ref.name}`}
                        value={ref.name}
                      >
                        {ref.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <PrepareBadges defaults={data.defaults} text={text} />
      </FieldGroup>

      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={closeOverlay} type="button" variant="outline">
          {context.i18n.t("ui.cancel", undefined, "Cancel")}
        </Button>
        <Button type="submit" variant="default">
          {text("confirm", undefined, "Create")}
        </Button>
      </div>
    </form>
  );
}

export function openWorktreeCreateOverlay(
  context: RendererPluginContext,
  data: WorktreeCreateOverlayData,
  targetGroupId?: string
): void {
  context.dialogs.open({
    id: "worktree-create",
    size: "lg",
    title: context.i18n.t("ui.worktreeCreate.title", undefined, "New Worktree"),
    description: context.i18n.t(
      "ui.worktreeCreate.description",
      undefined,
      "Create an isolated worktree for this task"
    ),
    content: ({ close }) => (
      <WorktreeCreateOverlay
        close={close}
        context={context}
        data={data}
        {...(targetGroupId ? { targetGroupId } : {})}
      />
    ),
  });
}
