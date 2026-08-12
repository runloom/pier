/**
 * run.output / run.rerun（W4-S3 tasks 同构扩展）。
 * shell TaskRuns only — 不接受 agentId 作为任务路径。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export function executeRunOutputCommand(
  requestId: string,
  command: Extract<PierCommand, { type: "run.output" }>,
  services: PierCoreServices
): PierCommandResult {
  const snap = services.tasks.statusRun(command.runId);
  if (!snap) {
    return failure(
      requestId,
      "not_found",
      `task run not found: ${command.runId}`
    );
  }
  const taskId =
    command.taskId ??
    snap.rootTaskId ??
    Object.keys(snap.nodes)[0] ??
    snap.rootTaskId;
  if (!taskId) {
    return failure(
      requestId,
      "not_found",
      `no taskId for run: ${command.runId}`
    );
  }
  const output = services.tasks.output(command.runId, taskId);
  if (!output) {
    return success(requestId, {
      runId: command.runId,
      taskId,
      chunks: [],
      truncated: false,
      empty: true,
    });
  }
  return success(requestId, output);
}

export function executeRunRerunCommand(
  requestId: string,
  _command: Extract<PierCommand, { type: "run.rerun" }>,
  _services: PierCoreServices
): PierCommandResult {
  // v1 骨架：不自动重放 spawn 参数（需调用方持有 taskId）；明确 unsupported 引导。
  return failure(
    requestId,
    "unsupported",
    "run.rerun requires caller to re-issue tasks run with the original taskId; automatic replay is not stored (shell-only, no task ledger)"
  );
}
