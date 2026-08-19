import {
  type CanvasHostWatchTarget,
  canvasHostInspect,
  canvasHostLiveChannel,
  canvasHostPermissionError,
  isCanvasHostCommandAllowed,
  normalizeCanvasHostSnapshotId,
} from "@shared/contracts/canvas-host.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { useEffect, useState } from "react";
import { decorateCanvasHostInspect } from "@/lib/canvas-host/inspect.ts";
import {
  acquirePierResourcePolling,
  usePierResourceStore,
} from "@/stores/pier-resource.store.ts";

export interface HostSnapshotState {
  data: unknown;
  error: string | null;
  status: "error" | "loading" | "ready";
}

function canvasHostBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  return window.pier?.canvasHost ?? null;
}

export const host = {
  inspect: () => decorateCanvasHostInspect(canvasHostInspect()),
  invoke: async (command: PierCommand) => {
    if (!isCanvasHostCommandAllowed(command.type)) {
      throw canvasHostPermissionError(`canvas host denies ${command.type}`);
    }
    const bridge = canvasHostBridge();
    if (!bridge) {
      throw canvasHostPermissionError("Canvas host is unavailable");
    }
    return bridge.invoke(command);
  },
  snapshot: async (id: string) => {
    const canonical = normalizeCanvasHostSnapshotId(id);
    if (!canonical) {
      throw canvasHostPermissionError(`canvas host denies ${id}`);
    }
    const bridge = canvasHostBridge();
    if (!bridge) {
      throw canvasHostPermissionError("Canvas host is unavailable");
    }
    return bridge.snapshot(canonical);
  },
  subscribe: (channel: string, listener: (payload: unknown) => void) => {
    const live = canvasHostLiveChannel(channel);
    if (!live) {
      throw canvasHostPermissionError(`canvas host denies ${channel}`);
    }
    const bridge = canvasHostBridge();
    if (!bridge) {
      throw canvasHostPermissionError("Canvas host is unavailable");
    }
    return bridge.subscribe(live, listener);
  },
};

function resourceSnapshotStatus(next: {
  error: string | null;
  snapshot: unknown;
}): HostSnapshotState["status"] {
  if (next.error && !next.snapshot) {
    return "error";
  }
  if (next.snapshot) {
    return "ready";
  }
  return "loading";
}

function isUnsupported(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "unsupported"
  );
}

export function useHostSnapshot(
  target: CanvasHostWatchTarget
): HostSnapshotState {
  const [state, setState] = useState<HostSnapshotState>({
    data: null,
    error: null,
    status: "loading",
  });

  useEffect(() => {
    const snapshotId = normalizeCanvasHostSnapshotId(target);
    const liveChannel = canvasHostLiveChannel(target);
    if (!(snapshotId || liveChannel)) {
      setState({
        data: null,
        error: `canvas host denies ${target}`,
        status: "error",
      });
      return;
    }

    if (snapshotId === "resources") {
      const release = acquirePierResourcePolling();
      const apply = (): void => {
        const next = usePierResourceStore.getState();
        setState({
          data: next.snapshot,
          error: next.error,
          status: resourceSnapshotStatus(next),
        });
      };
      apply();
      const unsub = usePierResourceStore.subscribe(apply);
      return () => {
        unsub();
        release();
      };
    }

    const bridge = canvasHostBridge();
    if (!bridge) {
      setState({ data: null, error: null, status: "ready" });
      return;
    }

    let cancelled = false;
    let pending: Promise<unknown> | undefined;
    const apply = (data: unknown): void => {
      if (!cancelled) {
        setState({ data, error: null, status: "ready" });
      }
    };
    const fail = (error: unknown): void => {
      if (cancelled) {
        return;
      }
      if (isUnsupported(error)) {
        setState({ data: null, error: null, status: "ready" });
        return;
      }
      setState({
        data: null,
        error: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    };
    if (snapshotId) {
      pending = bridge.snapshot(snapshotId).then(apply, fail);
    } else {
      setState({ data: null, error: null, status: "ready" });
    }
    const unsub = liveChannel
      ? bridge.subscribe(liveChannel, apply)
      : () => undefined;
    return () => {
      cancelled = true;
      unsub();
      pending?.catch(() => undefined);
    };
  }, [target]);

  return state;
}

export const pierHostRuntime = {
  host,
  useHostSnapshot,
};
