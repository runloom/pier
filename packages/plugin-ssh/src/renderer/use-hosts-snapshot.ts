import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useCallback, useSyncExternalStore } from "react";
import { HOSTS_CHANGED_EVENT, type SshHostsSnapshot } from "../shared/hosts.ts";

interface HostsSnapshotState {
  error: string | null;
  snapshot: SshHostsSnapshot | null;
}

interface HostsSnapshotStore {
  getSnapshot: () => HostsSnapshotState;
  reload: () => void;
  subscribe: (listener: () => void) => () => void;
}

const EMPTY_STATE: HostsSnapshotState = { error: null, snapshot: null };
const stores = new WeakMap<ExternalRendererPluginContext, HostsSnapshotStore>();

function createHostsSnapshotStore(
  context: ExternalRendererPluginContext
): HostsSnapshotStore {
  let state = EMPTY_STATE;
  let connectionGeneration = 0;
  let unsubscribeRpc: (() => void) | null = null;
  const listeners = new Set<() => void>();

  const publish = (next: HostsSnapshotState): void => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const acceptSnapshot = (snapshot: SshHostsSnapshot): void => {
    publish({ error: null, snapshot });
  };

  const fetchSnapshot = (generation: number): void => {
    context.rpc
      .invoke<SshHostsSnapshot>("hosts.snapshot")
      .then((initial) => {
        if (generation === connectionGeneration) {
          acceptSnapshot(initial);
        }
      })
      .catch((error: unknown) => {
        if (generation !== connectionGeneration) {
          return;
        }
        publish({
          error: error instanceof Error ? error.message : String(error),
          snapshot: state.snapshot,
        });
      });
  };

  const connect = (): void => {
    if (unsubscribeRpc) {
      return;
    }
    const generation = ++connectionGeneration;
    unsubscribeRpc = context.rpc.on<SshHostsSnapshot>(
      HOSTS_CHANGED_EVENT,
      acceptSnapshot
    );
    fetchSnapshot(generation);
  };

  const disconnect = (): void => {
    connectionGeneration += 1;
    unsubscribeRpc?.();
    unsubscribeRpc = null;
  };

  const reload = (): void => {
    if (!unsubscribeRpc) {
      connect();
      return;
    }
    const generation = ++connectionGeneration;
    publish({ error: null, snapshot: state.snapshot });
    fetchSnapshot(generation);
  };

  return {
    getSnapshot: () => state,
    reload,
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) {
        connect();
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          disconnect();
        }
      };
    },
  };
}

function getHostsSnapshotStore(
  context: ExternalRendererPluginContext
): HostsSnapshotStore {
  const existing = stores.get(context);
  if (existing) {
    return existing;
  }
  const created = createHostsSnapshotStore(context);
  stores.set(context, created);
  return created;
}

/**
 * Settings remounts share one RPC subscription + last successful snapshot so
 * revisiting the SSH section does not flash SettingsSkeleton.
 */
export function useSshHostsSnapshot(
  context: ExternalRendererPluginContext
): HostsSnapshotState & { reload: () => void } {
  const store = getHostsSnapshotStore(context);
  const state = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
  const reload = useCallback(() => {
    store.reload();
  }, [store]);
  return { ...state, reload };
}
