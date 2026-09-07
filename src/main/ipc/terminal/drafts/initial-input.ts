import type { AgentKind } from "@shared/contracts/agent.ts";
import type { ResolvedTerminalLaunchOptions } from "@shared/contracts/terminal/launch.ts";
import { resolveInteractiveInitialPrompt } from "../../../services/agents/initial-prompt.ts";
import { terminalDraftStore } from "../../../state/terminal-drafts/index.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import type { NativeTerminalProcess } from "../process/registry.ts";
import { windowRecordIdFor } from "../window-scope.ts";
import { refreshTerminalDraft } from "./broadcast.ts";

/** A failed checkpoint acknowledgement must not turn a created terminal into a blank error pane. */
export async function settleInitialInputCheckpoint(
  process: NativeTerminalProcess,
  settle: (created: boolean) => Promise<void>,
  created: boolean
): Promise<string | undefined> {
  try {
    await settle(created);
  } catch (error) {
    if (!created) throw error;
    process.inputDisposition = "unconfirmed";
    return error instanceof Error ? error.message : String(error);
  }
}

/** Execution-only prompt; the logical restore launch never includes it. */
export async function prepareInitialAgentInput(input: {
  agentId?: AgentKind | undefined;
  initialInput?: string | undefined;
  launch: ResolvedTerminalLaunchOptions | undefined;
  launchId: string;
  panelId: string;
  submit?: boolean | undefined;
  win: AppWindow;
}) {
  const noop = async (_created: boolean) => undefined;
  if (!(input.agentId && input.initialInput))
    return { launch: input.launch, disposition: undefined, settle: noop };
  const store = terminalDraftStore(),
    scope = windowRecordIdFor(input.win);
  const plan =
    input.submit === false
      ? { mode: "draft" as const }
      : await resolveInteractiveInitialPrompt({
          agentId: input.agentId,
          command: input.launch?.command ?? "",
          text: input.initialInput,
          cwd: input.launch?.cwd,
          env: input.launch?.env,
        });
  if (plan.mode === "draft") {
    await store.seed(scope, input.panelId, input.initialInput, input.launchId);
    await refreshTerminalDraft(input.win, input.panelId);
    return {
      launch: input.launch,
      disposition: "draft" as const,
      settle: noop,
    };
  }
  const checkpoint = await store.beginSend(
    scope,
    input.panelId,
    input.initialInput
  );
  return {
    launch: { ...input.launch, command: plan.command },
    disposition: "native-launch" as const,
    settle: async (created: boolean) => {
      await store.finishSend(
        scope,
        input.panelId,
        checkpoint,
        created ? "submitted" : "not-delivered"
      );
      await refreshTerminalDraft(input.win, input.panelId);
    },
  };
}
