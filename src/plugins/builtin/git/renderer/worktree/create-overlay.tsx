import { zodResolver } from "@hookform/resolvers/zod";
import { Button } from "@pier/ui/button.tsx";
import {
  DIALOG_COMMIT_FIELD_GROUP_CLASS,
  DIALOG_COMMIT_FORM_CLASS,
  DIALOG_FOOTER_ACTIONS_CLASS,
} from "@pier/ui/dialog-form-layout.ts";
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
import type { WorktreeCreationDraft } from "@shared/worktree-naming.ts";
import {
  deriveWorktreeCreation,
  sanitizeWorktreeName,
} from "@shared/worktree-naming.ts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Controller, useForm } from "react-hook-form";
import {
  buildFormSchema,
  type CreateMode,
  type FormValues,
  HEAD_SENTINEL,
  PrepareBadges,
  type WorktreeCreateOverlayData,
} from "./create-form.tsx";
import { AiModeFields, CustomModeField } from "./create-mode-fields.tsx";
import {
  readWorktreeCreateMode,
  readWorktreeCreateStartTask,
  writeWorktreeCreateMode,
} from "./create-preferences.ts";
import {
  type CreateOperationStage,
  submitWorktreeCreate,
} from "./create-submit.ts";

export type { WorktreeCreateOverlayData } from "./create-form.tsx";

interface WorktreeCreateOverlayProps {
  close: RendererPluginContentDialogRenderProps["close"];
  context: RendererPluginContext;
  data: WorktreeCreateOverlayData;
  setFooter: RendererPluginContentDialogRenderProps["setFooter"];
  targetGroupId?: string;
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
  setFooter,
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
      mode: readWorktreeCreateMode(),
      startTask: readWorktreeCreateStartTask(),
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
        // selectedId 已对齐设置页默认智能体(含 auto / blank),见 agents:selection IPC。
        // 每次打开只预填一次:agentId 为空或已不在可用列表时回落到设置默认。
        const currentAgentId = form.getValues("agentId");
        const currentIsEnabled =
          currentAgentId !== "" &&
          selection.rankedIds.includes(currentAgentId as AgentKind);
        if (selection.selectedId && !currentIsEnabled) {
          form.setValue("agentId", selection.selectedId);
        }
        // 无可用智能体时会话内关掉「立即开始任务」(不清缓存)。
        if (selection.rankedIds.length === 0 && form.getValues("startTask")) {
          form.setValue("startTask", false);
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
          if (form.getValues("startTask")) {
            form.setValue("startTask", false);
          }
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

  async function onSubmit(values: FormValues): Promise<void> {
    if (submittedRef.current) {
      return;
    }
    submittedRef.current = true;
    await submitWorktreeCreate({
      context,
      data,
      onClose: close,
      operationStageRef,
      text,
      values,
      ...(targetGroupId ? { targetGroupId } : {}),
    });
  }

  const worktreeFormId = "worktree-create-form";
  useLayoutEffect(() => {
    setFooter(
      <div className={DIALOG_FOOTER_ACTIONS_CLASS}>
        <Button
          onClick={() => {
            close();
          }}
          type="button"
          variant="outline"
        >
          {context.i18n.t("ui.cancel", undefined, "Cancel")}
        </Button>
        <Button form={worktreeFormId} type="submit" variant="default">
          {text("confirm", undefined, "Create")}
        </Button>
      </div>
    );
    return () => {
      setFooter(null);
    };
  }, [close, context.i18n, setFooter, text]);

  return (
    <form
      className={DIALOG_COMMIT_FORM_CLASS}
      data-slot="dialog-commit-form"
      id={worktreeFormId}
      onSubmit={form.handleSubmit(onSubmit)}
    >
      <FieldGroup className={DIALOG_COMMIT_FIELD_GROUP_CLASS}>
        <Tabs
          onValueChange={(value) => {
            const nextMode = value as CreateMode;
            form.setValue("mode", nextMode);
            form.clearErrors();
            writeWorktreeCreateMode(nextMode);
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
    content: ({ close, setFooter }) => (
      <WorktreeCreateOverlay
        close={close}
        context={context}
        data={data}
        setFooter={setFooter}
        {...(targetGroupId ? { targetGroupId } : {})}
      />
    ),
  });
}
