/**
 * control.snapshot / control.watch 会话 op（W4-S3）。
 */
import {
  controlSnapshotParamsSchema,
  controlWatchParamsSchema,
} from "@shared/contracts/local-control/control-snapshot.ts";
import { LOCAL_CONTROL_API_VERSION } from "@shared/contracts/local-control/errors.ts";
import type { LocalControlServerFrame } from "@shared/contracts/local-control/frames.ts";
import type { ControlSnapshotService } from "../../../services/control-snapshot/service.ts";
import { controlErrorResponse } from "./discovery.ts";

export function handleControlHoldOp(args: {
  requestId: string;
  params: Record<string, unknown>;
  inflight: Map<
    string,
    { ac: AbortController; kind: "hold" | "wait" | "watch" }
  >;
  disposed: () => boolean;
  emit: (frame: LocalControlServerFrame) => void;
}): void {
  if (args.inflight.has(args.requestId)) {
    args.emit(
      controlErrorResponse(
        args.requestId,
        "effect_in_progress",
        "request already in flight"
      )
    );
    return;
  }
  const msRaw = args.params.ms;
  const ms =
    typeof msRaw === "number" && Number.isFinite(msRaw)
      ? Math.min(Math.max(0, msRaw), 30_000)
      : 50;
  const ac = new AbortController();
  args.inflight.set(args.requestId, { ac, kind: "hold" });
  const timer = setTimeout(() => {
    if (ac.signal.aborted || args.disposed()) {
      return;
    }
    args.inflight.delete(args.requestId);
    args.emit({
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: args.requestId,
      ok: true,
      data: { heldMs: ms },
    });
  }, ms);
  ac.signal.addEventListener("abort", () => clearTimeout(timer));
}

export async function handleControlSnapshotOp(args: {
  requestId: string;
  params: Record<string, unknown>;
  snapshotService: ControlSnapshotService | undefined;
}): Promise<LocalControlServerFrame> {
  if (!args.snapshotService) {
    return controlErrorResponse(
      args.requestId,
      "unsupported",
      "control.snapshot not wired"
    );
  }
  const parsed = controlSnapshotParamsSchema.safeParse(args.params);
  if (!parsed.success) {
    return controlErrorResponse(
      args.requestId,
      "invalid_command",
      parsed.error.issues[0]?.message ?? "invalid snapshot params"
    );
  }
  // scope 过滤未实现：非空 scope 明确拒绝，避免脚本误以为已过滤
  if (parsed.data.scope !== undefined && parsed.data.scope.length > 0) {
    return controlErrorResponse(
      args.requestId,
      "unsupported",
      "control.snapshot scope filtering is not implemented; omit --scope for full snapshot"
    );
  }
  try {
    const data = await args.snapshotService.snapshot();
    return {
      apiVersion: LOCAL_CONTROL_API_VERSION,
      type: "response",
      requestId: args.requestId,
      ok: true,
      data,
    };
  } catch (err) {
    return controlErrorResponse(
      args.requestId,
      "internal_error",
      err instanceof Error ? err.message : "control.snapshot failed"
    );
  }
}

export async function handleControlWatchOp(args: {
  requestId: string;
  params: Record<string, unknown>;
  bootId: string;
  snapshotService: ControlSnapshotService | undefined;
  inflight: Map<
    string,
    { ac: AbortController; kind: "hold" | "wait" | "watch" }
  >;
  disposed: () => boolean;
  emit: (frame: LocalControlServerFrame) => void;
}): Promise<void> {
  if (!args.snapshotService) {
    args.emit(
      controlErrorResponse(
        args.requestId,
        "unsupported",
        "control.watch not wired"
      )
    );
    return;
  }
  const parsed = controlWatchParamsSchema.safeParse(args.params);
  if (!parsed.success) {
    args.emit(
      controlErrorResponse(
        args.requestId,
        "invalid_command",
        parsed.error.issues[0]?.message ?? "invalid watch params"
      )
    );
    return;
  }
  if (args.inflight.has(args.requestId)) {
    args.emit(
      controlErrorResponse(
        args.requestId,
        "effect_in_progress",
        "request already in flight"
      )
    );
    return;
  }
  const timeoutMs = parsed.data.timeoutMs ?? 30_000;
  const pollMs = parsed.data.pollMs ?? 500;
  const after = parsed.data.after;
  const ac = new AbortController();
  args.inflight.set(args.requestId, { ac, kind: "watch" });

  const started = Date.now();
  let lastRevision = after ?? -1;
  const snapshotService = args.snapshotService;

  const failWatch = (message: string) => {
    if (args.inflight.has(args.requestId)) {
      args.inflight.delete(args.requestId);
    }
    if (!args.disposed()) {
      args.emit(
        controlErrorResponse(args.requestId, "internal_error", message)
      );
    }
  };

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(timer);
        resolve();
      };
      if (ac.signal.aborted) {
        onAbort();
        return;
      }
      ac.signal.addEventListener("abort", onAbort, { once: true });
    });

  const tick = async () => {
    try {
      if (after === undefined) {
        const first = await snapshotService.snapshot();
        lastRevision = first.revision;
        if (!(args.disposed() || ac.signal.aborted)) {
          args.emit({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "event",
            subscriptionId: args.requestId,
            bootId: args.bootId,
            revision: first.revision,
            cursorScope: "global",
            mode: "snapshot",
            payload: first,
          });
        }
      }

      while (!(ac.signal.aborted || args.disposed())) {
        if (Date.now() - started >= timeoutMs) {
          args.inflight.delete(args.requestId);
          args.emit({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "response",
            requestId: args.requestId,
            ok: true,
            data: {
              timedOut: true,
              lastRevision,
            },
          });
          return;
        }
        const snap = await snapshotService.snapshot();
        if (snap.revision > lastRevision) {
          lastRevision = snap.revision;
          args.emit({
            apiVersion: LOCAL_CONTROL_API_VERSION,
            type: "event",
            subscriptionId: args.requestId,
            bootId: args.bootId,
            revision: snap.revision,
            cursorScope: "global",
            mode: "live",
            payload: snap,
          });
        }
        await sleep(pollMs);
      }
      if (args.inflight.has(args.requestId)) {
        args.inflight.delete(args.requestId);
        args.emit({
          apiVersion: LOCAL_CONTROL_API_VERSION,
          type: "response",
          requestId: args.requestId,
          ok: true,
          data: { cancelled: true, lastRevision },
        });
      }
    } catch (err) {
      failWatch(err instanceof Error ? err.message : "control.watch failed");
    }
  };

  // fire-and-forget poll loop（失败由 tick 内 failWatch 结算）
  tick().catch((err: unknown) => {
    failWatch(err instanceof Error ? err.message : "control.watch failed");
  });
}
