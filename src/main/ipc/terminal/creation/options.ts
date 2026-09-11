import type { AgentKind } from "@shared/contracts/agent.ts";
import type { CreateTerminalArgs } from "@shared/contracts/terminal.ts";
import type { LocalEnvironmentService } from "../../../services/local-environments-service.ts";
import type { ProcessEnvironmentService } from "../../../services/process-environment-service.ts";
import type { ManagedAgentLaunchGate } from "../../../services/project-skills/launch-gate/index.ts";
import type { TaskService } from "../../../services/tasks/service-types.ts";
import type { AppWindow } from "../../../windows/app-window.ts";
import type { NativeAddon } from "../native-addon.ts";
import type { RegisteredTerminalTaskLifecycle } from "../task/lifecycle-wiring.ts";
import type { TaskOutputTerminalBindings } from "../task/output-bindings.ts";
export interface TerminalCreateOptions {
  addon: NativeAddon | null;
  createArgs: CreateTerminalArgs;
  launchGate?: ManagedAgentLaunchGate | null | undefined;
  loadError: string | null;
  localEnvironments?:
    | Pick<LocalEnvironmentService, "resolveForWorktree" | "resolveProject">
    | null
    | undefined;
  processEnvironment: ProcessEnvironmentService;
  recordAgentLaunch?:
    | ((agentId: AgentKind) => Promise<unknown> | unknown)
    | undefined;
  taskLifecycle: RegisteredTerminalTaskLifecycle;
  taskOutputBindings: TaskOutputTerminalBindings | null;
  taskService: TaskService | null;
  win: AppWindow | null;
}
