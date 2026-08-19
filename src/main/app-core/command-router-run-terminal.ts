/**
 * run.* / terminal.* 命令分发（从 command-router 抽出以控制文件行数）。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import type { CommandExecutionContext } from "./command-execution-context.ts";
import { commandSuccess as success } from "./command-results.ts";
import type { PierCoreServices } from "./command-router-services.ts";
import { executeTerminalOpenCommand } from "./commands/panel.ts";
import {
  executeRunCancelCommand,
  executeRunListCommand,
  executeRunRecentCommand,
  executeRunSpawnCommand,
  executeRunStatusCommand,
} from "./commands/run.ts";
import {
  executeRunBackgroundSnapshotCommand,
  executeRunRunsSnapshotCommand,
  executeRunStopCommand,
} from "./commands/run-control.ts";
import {
  executeRunOutputCommand,
  executeRunRerunCommand,
} from "./commands/run-output.ts";
import { executeTerminalCloseCommand } from "./commands/terminal-close.ts";
import {
  executeTerminalGetCommand,
  executeTerminalKeyCommand,
  executeTerminalListCommand,
  executeTerminalSendCommand,
} from "./commands/terminal-control.ts";
import {
  executeTerminalReadCommand,
  executeTerminalScreenCommand,
} from "./commands/terminal-screen.ts";

export async function executeRunCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "run.backgroundSnapshot":
      return executeRunBackgroundSnapshotCommand(requestId, services);
    case "run.runsSnapshot":
      return executeRunRunsSnapshotCommand(requestId, command, services);
    case "run.list":
      return await executeRunListCommand(requestId, command, services);
    case "run.spawn":
      return await executeRunSpawnCommand(requestId, command, services, {
        clientEnv: context.clientEnv,
      });
    case "run.status":
      return executeRunStatusCommand(requestId, command, services);
    case "run.cancel":
      return executeRunCancelCommand(requestId, command, services);
    case "run.stop":
      return executeRunStopCommand(requestId, command, services);
    case "run.output":
      return executeRunOutputCommand(requestId, command, services);
    case "run.rerun":
      return executeRunRerunCommand(requestId, command, services);
    case "run.recent":
      return executeRunRecentCommand(requestId, services);
    default:
      return null;
  }
}

export async function executeTerminalCommand(
  requestId: string,
  command: PierCommand,
  services: PierCoreServices,
  context: CommandExecutionContext
): Promise<PierCommandResult | null> {
  switch (command.type) {
    case "terminal.open":
      return await executeTerminalOpenCommand(requestId, command, services, {
        clientEnv: context.clientEnv,
      });
    case "terminal.list":
      return await executeTerminalListCommand(requestId, command, services);
    case "terminal.get":
      return await executeTerminalGetCommand(requestId, command, services);
    case "terminal.send":
      return await executeTerminalSendCommand(requestId, command, services);
    case "terminal.key":
      return await executeTerminalKeyCommand(requestId, command, services);
    case "terminal.screen":
      return await executeTerminalScreenCommand(requestId, command, services);
    case "terminal.read":
      return await executeTerminalReadCommand(requestId, command, services);
    case "terminal.close":
      return await executeTerminalCloseCommand(requestId, command, services);
    case "terminal.profile.delete":
      return success(
        requestId,
        await services.terminalProfiles.delete(command.profileId)
      );
    case "terminal.profile.list":
      return success(requestId, await services.terminalProfiles.list());
    case "terminal.profile.read":
      return success(
        requestId,
        await services.terminalProfiles.read(command.profileId)
      );
    case "terminal.profile.upsert":
      return success(
        requestId,
        await services.terminalProfiles.upsert(
          command.profileId,
          command.profile
        )
      );
    default:
      return null;
  }
}
