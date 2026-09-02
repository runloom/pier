import {
  type CanvasHostWatchTarget,
  canvasHostInspect,
  canvasHostLiveChannel,
  canvasHostPermissionError,
  extractPluginDataEvent,
  isCanvasHostCommandAllowed,
  isPluginDataEventFor,
  normalizeCanvasHostSnapshotId,
  parsePluginDataWatchTarget,
  pluginDataCommandPayload,
} from "@shared/contracts/canvas-host.ts";
import type { PierCommand } from "@shared/contracts/commands.ts";
import { PIER_BROADCAST } from "@shared/ipc-channels.ts";
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
    if (command.type === "app.openExternal") {
      // Preload facade keeps the user-activation gate for canvases; the main
      // command path stays as the backstop for non-renderer clients.
      return window.pier.externalNavigation.open(command.url);
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
  target: CanvasHostWatchTarget | (string & {})
): HostSnapshotState {
  const [state, setState] = useState<HostSnapshotState>({
    data: null,
    error: null,
    status: "loading",
  });

  useEffect(() => {
    const snapshotId = normalizeCanvasHostSnapshotId(target);
    const liveChannel = canvasHostLiveChannel(target);
    // 插件投影目标不走快照别名/live 通道表，单独解析。
    const pluginTarget = parsePluginDataWatchTarget(target);
    if (!(snapshotId || liveChannel || pluginTarget)) {
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
    // Push payloads are the freshest truth; the initial snapshot pull only
    // hydrates. If a broadcast lands while the pull is in flight, the stale
    // snapshot resolution must not overwrite it.
    let pushed = false;
    let pending: Promise<unknown> | undefined;
    const apply = (data: unknown): void => {
      if (!cancelled) {
        setState({ data, error: null, status: "ready" });
      }
    };
    const applyPush = (data: unknown): void => {
      pushed = true;
      apply(data);
    };
    const applySnapshot = (data: unknown): void => {
      if (!pushed) {
        apply(data);
      }
    };
    const fail = (error: unknown): void => {
      if (cancelled || pushed) {
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
    if (pluginTarget) {
      const payload = pluginDataCommandPayload(pluginTarget);
      pending = bridge
        .invoke({
          payload,
          type: "pluginData.snapshot",
        })
        .then(applySnapshot, fail);
      bridge
        .invoke({
          payload,
          type: "pluginData.watchStart",
        })
        .catch(() => undefined);
      const unsub = bridge.subscribe(
        PIER_BROADCAST.PLUGIN_DATA_CHANGED,
        (event) => {
          if (!isPluginDataEventFor(event, pluginTarget)) {
            return;
          }
          applyPush(extractPluginDataEvent(event));
        }
      );
      return () => {
        cancelled = true;
        unsub();
        pending?.catch(() => undefined);
        bridge
          .invoke({
            payload,
            type: "pluginData.watchStop",
          })
          .catch(() => undefined);
      };
    }
    if (snapshotId) {
      pending = bridge.snapshot(snapshotId).then(applySnapshot, fail);
    } else {
      setState({ data: null, error: null, status: "ready" });
    }
    const unsub = liveChannel
      ? bridge.subscribe(liveChannel, applyPush)
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
