/**
 * @vitest-environment jsdom
 */
import type { ExternalRendererPluginContext } from "@pier/plugin-api/renderer";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useSshHostsSnapshot } from "../../../../packages/plugin-ssh/src/renderer/use-hosts-snapshot.ts";
import {
  HOSTS_CHANGED_EVENT,
  type SshHostsSnapshot,
} from "../../../../packages/plugin-ssh/src/shared/hosts.ts";

const snapshotA: SshHostsSnapshot = {
  hosts: [
    {
      host: "example.com",
      id: "host-1",
      name: "Example",
      port: 22,
    },
  ],
};

const snapshotB: SshHostsSnapshot = {
  hosts: [
    {
      host: "other.example",
      id: "host-2",
      name: "Other",
    },
  ],
};

function createContext(initial: SshHostsSnapshot = snapshotA): {
  context: ExternalRendererPluginContext;
  emitChanged: (next: SshHostsSnapshot) => void;
  invoke: ReturnType<typeof vi.fn>;
} {
  const listeners = new Set<(payload: SshHostsSnapshot) => void>();
  const invoke = vi.fn(() => Promise.resolve(initial));
  const context = {
    rpc: {
      invoke,
      on: vi.fn(
        (_event: string, listener: (payload: SshHostsSnapshot) => void) => {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        }
      ),
    },
  } as unknown as ExternalRendererPluginContext;
  return {
    context,
    emitChanged: (next) => {
      for (const listener of listeners) {
        listener(next);
      }
    },
    invoke,
  };
}

describe("useSshHostsSnapshot", () => {
  it("loads the initial snapshot once for the first subscriber", async () => {
    const { context, invoke } = createContext();
    const { result } = renderHook(() => useSshHostsSnapshot(context));

    expect(result.current.snapshot).toBeNull();
    await waitFor(() => {
      expect(result.current.snapshot).toEqual(snapshotA);
    });
    expect(invoke).toHaveBeenCalledWith("hosts.snapshot");
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached snapshot across remount so settings does not flash empty", async () => {
    const { context, invoke } = createContext();
    const first = renderHook(() => useSshHostsSnapshot(context));
    await waitFor(() => {
      expect(first.result.current.snapshot).toEqual(snapshotA);
    });
    first.unmount();

    invoke.mockClear();
    invoke.mockImplementation(() => Promise.resolve(snapshotA));

    const second = renderHook(() => useSshHostsSnapshot(context));
    expect(second.result.current.snapshot).toEqual(snapshotA);
    expect(second.result.current.error).toBeNull();

    await waitFor(() => {
      expect(invoke).toHaveBeenCalledTimes(1);
    });
    expect(second.result.current.snapshot).toEqual(snapshotA);
  });

  it("applies hosts.changed pushes after reconnect", async () => {
    const { context, emitChanged } = createContext();
    const first = renderHook(() => useSshHostsSnapshot(context));
    await waitFor(() => {
      expect(first.result.current.snapshot).toEqual(snapshotA);
    });
    first.unmount();

    const second = renderHook(() => useSshHostsSnapshot(context));
    expect(second.result.current.snapshot).toEqual(snapshotA);

    await waitFor(() => {
      expect(context.rpc.on).toHaveBeenCalledWith(
        HOSTS_CHANGED_EVENT,
        expect.any(Function)
      );
    });

    act(() => {
      emitChanged(snapshotB);
    });
    expect(second.result.current.snapshot).toEqual(snapshotB);
  });

  it("keeps the last snapshot when a later fetch fails", async () => {
    const { context, invoke } = createContext();
    const first = renderHook(() => useSshHostsSnapshot(context));
    await waitFor(() => {
      expect(first.result.current.snapshot).toEqual(snapshotA);
    });
    first.unmount();

    invoke.mockImplementation(() => Promise.reject(new Error("rpc down")));
    const second = renderHook(() => useSshHostsSnapshot(context));
    expect(second.result.current.snapshot).toEqual(snapshotA);

    await waitFor(() => {
      expect(second.result.current.error).toBe("rpc down");
    });
    expect(second.result.current.snapshot).toEqual(snapshotA);
  });
});
