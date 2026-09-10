import { describe, expect, it } from "vitest";
import { createHostNodeRuntimeProbe } from "../../../../src/main/services/process-environment/host-node-runtime.ts";

function probe(overrides: {
  resolveOnPath?: (cmd: string) => string | null;
  runVersion?: (path: string, timeoutMs: number) => Promise<string | null>;
}) {
  return createHostNodeRuntimeProbe({
    env: () => ({ PATH: "/usr/bin" }) as NodeJS.ProcessEnv,
    resolveOnPath: overrides.resolveOnPath ?? (() => "/usr/bin/node"),
    runVersion: overrides.runVersion ?? (async () => "v24.15.0"),
  });
}

describe("host node runtime probe", () => {
  it("returns path and normalized version", async () => {
    const runtime = probe({});
    await expect(runtime.probe()).resolves.toEqual({
      path: "/usr/bin/node",
      version: "v24.15.0",
    });
  });

  it("spawns once per resolved path", async () => {
    let calls = 0;
    const runtime = probe({
      runVersion: async () => {
        calls += 1;
        return "v24.15.0";
      },
    });
    await runtime.probe();
    await runtime.probe();
    expect(calls).toBe(1);
  });

  it("re-probes when the resolved path changes", async () => {
    let path = "/usr/bin/node";
    let calls = 0;
    const runtime = createHostNodeRuntimeProbe({
      env: () => ({ PATH: "/usr/bin" }) as NodeJS.ProcessEnv,
      resolveOnPath: () => path,
      runVersion: async () => {
        calls += 1;
        return "v22.0.0";
      },
    });
    await runtime.probe();
    path = "/opt/homebrew/bin/node";
    await runtime.probe();
    expect(calls).toBe(2);
  });

  it("re-probes after clear()", async () => {
    let calls = 0;
    const runtime = probe({
      runVersion: async () => {
        calls += 1;
        return "v24.15.0";
      },
    });
    await runtime.probe();
    runtime.clear();
    await runtime.probe();
    expect(calls).toBe(2);
  });

  it("returns null when node is not on PATH", async () => {
    const runtime = probe({ resolveOnPath: () => null });
    await expect(runtime.probe()).resolves.toBeNull();
  });

  it("returns null when version output is not a version", async () => {
    const runtime = probe({ runVersion: async () => "not-a-version" });
    await expect(runtime.probe()).resolves.toBeNull();
  });

  it("runs node --version with the caller-supplied env", async () => {
    const seen: Array<{
      env: NodeJS.ProcessEnv | undefined;
      path: string;
    }> = [];
    const runtime = createHostNodeRuntimeProbe({
      env: () => ({ PATH: "/old/bin" }) as NodeJS.ProcessEnv,
      resolveOnPath: () => "/nvm/bin/node",
      runVersion: async (path, _timeout, env) => {
        seen.push({ env, path });
        return "v24.16.0";
      },
    });
    await runtime.probe({
      MISE_SHELL: "zsh",
      PATH: "/nvm/bin",
    } as NodeJS.ProcessEnv);
    expect(seen).toEqual([
      {
        env: { MISE_SHELL: "zsh", PATH: "/nvm/bin" },
        path: "/nvm/bin/node",
      },
    ]);
  });

  it("probes the caller-supplied env PATH, not the construction default", async () => {
    const runtime = createHostNodeRuntimeProbe({
      env: () => ({ PATH: "/old/bin" }) as NodeJS.ProcessEnv,
      resolveOnPath: (_cmd, pathEnv) =>
        pathEnv?.includes("/nvm") ? "/nvm/bin/node" : "/old/bin/node",
      runVersion: async (path) =>
        path.includes("/nvm") ? "v24.16.0" : "v24.15.0",
    });
    await expect(
      runtime.probe({ PATH: "/nvm/bin" } as NodeJS.ProcessEnv)
    ).resolves.toEqual({
      path: "/nvm/bin/node",
      version: "v24.16.0",
    });
  });

  it("returns null when the version spawn times out", async () => {
    const runtime = probe({ runVersion: async () => null });
    await expect(runtime.probe()).resolves.toBeNull();
  });
});
