/**
 * app.snapshot v1 短命令：与 control.snapshot 同构聚合（含 worktrees）。
 * 优先复用 local-control 注入的共享 ControlSnapshotService（同一 revision）。
 */
import type {
  PierCommand,
  PierCommandResult,
} from "@shared/contracts/commands.ts";
import { controlSnapshotSourcesFromCore } from "../../services/control-snapshot/from-core.ts";
import { createControlSnapshotService } from "../../services/control-snapshot/service.ts";
import {
  commandFailure as failure,
  commandSuccess as success,
} from "../command-results.ts";
import type { PierCoreServices } from "../command-router-services.ts";

export async function executeAppSnapshotCommand(
  requestId: string,
  _command: Extract<PierCommand, { type: "app.snapshot" }>,
  services: PierCoreServices
): Promise<PierCommandResult> {
  try {
    const shared = services.controlSnapshot;
    const svc =
      shared ??
      createControlSnapshotService(
        controlSnapshotSourcesFromCore(
          services,
          services.controlBootId ?? "main"
        )
      );
    const data = await svc.snapshot();
    return success(requestId, data);
  } catch (err) {
    return failure(
      requestId,
      "internal_error",
      err instanceof Error ? err.message : String(err)
    );
  }
}
