import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { useSyncExternalStore } from "react";
import { HOSTS_CHANGED_EVENT, type SshHostsSnapshot } from "../shared/hosts.ts";

interface HostsSnapshotState {
  error: string | null;
  snapshot: SshHostsSnapshot | null;
}

interface HostsSnapshotStore {
  getSnapshot: () => HostsSnapshotState;
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

  const connect = (): void => {
    if (unsubscribeRpc) {
      return;
    }
    const generation = ++connectionGeneration;
    unsubscribeRpc = context.rpc.on<SshHostsSnapshot>(
      HOSTS_CHANGED_EVENT,
      acceptSnapshot
    );
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

  const disconnect = (): void => {
    connectionGeneration += 1;
    unsubscribeRpc?.();
    unsubscribeRpc = null;
  };

  return {
    getSnapshot: () => state,
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
): HostsSnapshotState {
  const store = getHostsSnapshotStore(context);
  return useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot
  );
}
