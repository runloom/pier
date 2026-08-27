import {
  applyHostProcessEnv,
  createProcessEnvironmentService,
  parseShellEnvironmentOutput,
  shouldApplyHostEnvKey,
} from "@main/services/process-environment-service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ABSOLUTE_SHELL_RE = /^\//;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("process environment service", () => {
  it("does not expose Pier's packaged esbuild binary to terminal shells", async () => {
    const service = createProcessEnvironmentService({
      baseEnv: {
        ESBUILD_BINARY_PATH:
          "/Applications/Pier.app/Contents/Resources/app.asar.unpacked/node_modules/@esbuild/darwin-arm64/bin/esbuild",
        PATH: "/app/bin",
      },
      loadShellEnv: async () => ({
        env: {},
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({ source: "terminal" });

    expect(result.env.ESBUILD_BINARY_PATH).toBeUndefined();
  });

  it("preserves an explicitly configured non-Pier esbuild binary", async () => {
    const service = createProcessEnvironmentService({
      baseEnv: {
        ESBUILD_BINARY_PATH: "/custom/esbuild",
        PATH: "/app/bin",
      },
      loadShellEnv: async () => ({
        env: {},
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({ source: "terminal" });

    expect(result.env.ESBUILD_BINARY_PATH).toBe("/custom/esbuild");
  });

  it("merges layers in normative order (project covers agent; explicit highest)", async () => {
    const service = createProcessEnvironmentService({
      baseEnv: {
        BASE_ONLY: "base",
        FROM_SHELL: "base",
        PATH: "/app/bin",
      },
      loadShellEnv: async () => ({
        env: {
          FROM_CLI: "shell",
          FROM_SHELL: "shell",
          PATH: "/shell/bin",
        },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    await expect(
      service.resolve({
        agentEnv: { FROM_AGENT: "agent", PATH: "/agent/bin" },
        clientEnv: { FROM_CLI: "cli", PATH: "/cli/bin" },
        cwd: "/Users/dev/ABC/pier",
        explicitEnv: { FROM_EXPLICIT: "explicit", PATH: "/explicit/bin" },
        profileEnv: { FROM_PROFILE: "profile", PATH: "/profile/bin" },
        projectEnv: { FROM_PROJECT: "project", PATH: "/project/bin" },
        source: "terminal",
      })
    ).resolves.toMatchObject({
      diagnostics: {
        cacheHit: false,
        pathChanged: true,
        shellEnvStatus: "resolved",
        source: "terminal",
      },
      env: {
        BASE_ONLY: "base",
        FROM_AGENT: "agent",
        FROM_CLI: "cli",
        FROM_EXPLICIT: "explicit",
        FROM_PROFILE: "profile",
        FROM_PROJECT: "project",
        FROM_SHELL: "shell",
        PATH: "/explicit/bin",
      },
    });
  });

  it("lets projectEnv override agentEnv when explicit is absent", async () => {
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => ({
        env: { PATH: "/shell/bin" },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({
      agentEnv: { NODE_ENV: "agent", PATH: "/agent/bin" },
      projectEnv: { NODE_ENV: "project", PATH: "/project/bin" },
      source: "task",
    });

    expect(result.env.NODE_ENV).toBe("project");
    expect(result.env.PATH).toBe("/project/bin");
  });

  it("caches dump by project root (or HOME), not each task cwd", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { HOME: "/Users/me", PATH: "/app/bin" },
      loadShellEnv,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    await service.resolve({
      cwd: "/repo/pkg",
      projectRootPath: "/repo",
      source: "task",
    });
    const second = await service.resolve({
      cwd: "/repo/other",
      projectRootPath: "/repo",
      source: "terminal",
    });
    await service.resolve({ cwd: "/tmp/task", source: "task" });

    expect(loadShellEnv).toHaveBeenCalledTimes(2);
    expect(loadShellEnv).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ cwd: "/repo" })
    );
    expect(loadShellEnv).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cwd: "/Users/me" })
    );
    expect(second.diagnostics).toMatchObject({
      cacheHit: true,
      shellEnvStatus: "cached",
    });
  });

  it("does not write project dump onto process.env", async () => {
    const prevPath = process.env.PATH;
    try {
      process.env.PATH = "/host";
      const service = createProcessEnvironmentService({
        baseEnv: { HOME: "/Users/me", PATH: "/host" },
        loadShellEnv: async () => ({
          env: { PATH: "/project/dump" },
          status: "resolved" as const,
        }),
        platform: "darwin",
        shell: "/bin/zsh",
      });
      const result = await service.resolve({
        projectRootPath: "/repo",
        source: "task",
      });
      expect(result.env.PATH).toBe("/project/dump");
      expect(process.env.PATH).toBe("/host");
    } finally {
      process.env.PATH = prevPath;
    }
  });

  it("uses an OS default shell when SHELL is missing", async () => {
    vi.stubEnv("SHELL", "");
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv,
      platform: "darwin",
    });

    await service.resolve({
      cwd: "/repo",
      projectRootPath: "/repo",
      source: "terminal",
    });

    expect(loadShellEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        shell: expect.stringMatching(ABSOLUTE_SHELL_RE),
        source: "terminal",
      })
    );
  });

  it("falls back to non-shell env when shell loading fails", async () => {
    const onShellEnvFailed = vi.fn();
    const service = createProcessEnvironmentService({
      baseEnv: { BASE_ONLY: "base", PATH: "/app/bin" },
      loadShellEnv: () => Promise.reject(new Error("shell failed")),
      onShellEnvFailed,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    await expect(
      service.resolve({
        clientEnv: { FROM_CLI: "cli" },
        explicitEnv: { FROM_EXPLICIT: "explicit" },
        source: "task",
      })
    ).resolves.toMatchObject({
      diagnostics: {
        error: "shell failed",
        shellEnvStatus: "failed",
      },
      env: {
        BASE_ONLY: "base",
        FROM_CLI: "cli",
        FROM_EXPLICIT: "explicit",
        PATH: "/app/bin",
      },
    });
    expect(onShellEnvFailed).toHaveBeenCalledTimes(1);
  });

  it("negative-caches dump failures for 30s without re-notifying", async () => {
    vi.useFakeTimers();
    const loadShellEnv = vi.fn(() => Promise.reject(new Error("shell failed")));
    const onShellEnvFailed = vi.fn();
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv,
      onShellEnvFailed,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    await service.resolve({ cwd: "/repo", source: "task" });
    await service.resolve({ cwd: "/repo", source: "task" });
    expect(loadShellEnv).toHaveBeenCalledTimes(1);
    expect(onShellEnvFailed).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_001);
    await service.resolve({ cwd: "/repo", source: "task" });
    expect(loadShellEnv).toHaveBeenCalledTimes(2);
    expect(onShellEnvFailed).toHaveBeenCalledTimes(2);
  });

  it("skips shell dump when launched from CLI (env already inherited)", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/from/terminal/bin", PIER_CLI: "1" },
      loadShellEnv,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({ source: "plugin" });
    expect(loadShellEnv).not.toHaveBeenCalled();
    expect(result.diagnostics.shellEnvStatus).toBe("skipped");
    expect(result.diagnostics.skipReason).toBe("cli");
    expect(result.env.PATH).toBe("/from/terminal/bin");
  });

  it("skips shell dump when isDisabled returns true", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      isDisabled: () => true,
      loadShellEnv,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({ source: "plugin" });
    expect(result.diagnostics.shellEnvStatus).toBe("skipped");
    expect(result.env.PATH).toBe("/app/bin");
    expect(loadShellEnv).not.toHaveBeenCalled();
  });

  it("skips shell dump on win32", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "C:\\Windows" },
      loadShellEnv,
      platform: "win32",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({ source: "task" });
    expect(result.diagnostics.shellEnvStatus).toBe("skipped");
    expect(loadShellEnv).not.toHaveBeenCalled();
  });

  it("records and returns host diagnostics; invalidate clears caches", async () => {
    let loads = 0;
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => {
        loads += 1;
        return {
          env: { PATH: `/shell/${loads}` },
          status: "resolved" as const,
        };
      },
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const first = await service.resolve({ cwd: "/repo", source: "plugin" });
    expect(first.shellEnv.PATH).toBe("/shell/1");
    service.recordHostDiagnostics({
      ...first.diagnostics,
      hostAppliedStatus: "applied",
    });
    expect(service.getHostDiagnostics()?.hostAppliedStatus).toBe("applied");

    await service.resolve({ cwd: "/repo", source: "plugin" });
    expect(loads).toBe(1);

    await service.invalidate();
    await service.resolve({ cwd: "/repo", source: "plugin" });
    expect(loads).toBe(2);
  });

  it("reapplyHost tracks lastAppliedKeys so stale whitelist keys are removed", async () => {
    let phase = 0;
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app" },
      loadShellEnv: async () => {
        phase += 1;
        if (phase === 1) {
          return {
            env: { NVM_BIN: "/old/nvm/bin", PATH: "/shell/1" },
            status: "resolved" as const,
          };
        }
        return {
          env: { PATH: "/shell/2" },
          status: "resolved" as const,
        };
      },
      platform: "darwin",
      shell: "/bin/zsh",
    });

    // Service-owned apply mutates real process.env — restore after.
    const prevPath = process.env.PATH;
    const prevNvm = process.env.NVM_BIN;
    try {
      Reflect.deleteProperty(process.env, "NVM_BIN");
      process.env.PATH = "/app";

      await service.invalidate({ reapplyHost: true });
      expect(process.env.PATH).toBe("/shell/1");
      expect(process.env.NVM_BIN).toBe("/old/nvm/bin");

      await service.invalidate({ reapplyHost: true });
      expect(process.env.PATH).toBe("/shell/2");
      expect(process.env.NVM_BIN).toBeUndefined();
    } finally {
      if (prevPath === undefined) {
        Reflect.deleteProperty(process.env, "PATH");
      } else {
        process.env.PATH = prevPath;
      }
      if (prevNvm === undefined) {
        Reflect.deleteProperty(process.env, "NVM_BIN");
      } else {
        process.env.NVM_BIN = prevNvm;
      }
    }
  });

  it("rewrites unexpanded $ZED_* cwd before dump (never pass placeholder to loader)", async () => {
    const seenCwds: Array<string | undefined> = [];
    const service = createProcessEnvironmentService({
      baseEnv: { HOME: "/Users/me", PATH: "/app" },
      loadShellEnv: async (req) => {
        seenCwds.push(req.cwd);
        return {
          env: { PATH: "/shell" },
          status: "resolved" as const,
        };
      },
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await service.resolve({
      cwd: "$ZED_WORKTREE_ROOT",
      source: "task",
    });
    expect(result.diagnostics.shellEnvStatus).toBe("resolved");
    expect(seenCwds).toHaveLength(1);
    expect(seenCwds[0]).toBe("/Users/me");
  });

  it("dumps at projectRootPath rather than task cwd", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { HOME: "/Users/me", PATH: "/app" },
      loadShellEnv,
      platform: "darwin",
      shell: "/bin/zsh",
    });
    await service.resolve({
      cwd: "/repo/pkg",
      projectRootPath: "/repo",
      source: "terminal",
    });
    expect(loadShellEnv).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: "/repo", source: "terminal" })
    );
  });

  it("invalidate supersedes in-flight dumps (no late cache write / notify)", async () => {
    const onShellEnvFailed = vi.fn();
    let releaseLoad!: () => void;
    const loadGate = new Promise<void>((resolve) => {
      releaseLoad = resolve;
    });
    let loads = 0;
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app" },
      loadShellEnv: async () => {
        loads += 1;
        const id = loads;
        if (id === 1) {
          await loadGate;
          return {
            env: { PATH: "/stale" },
            status: "resolved" as const,
          };
        }
        return {
          env: { PATH: "/fresh" },
          status: "resolved" as const,
        };
      },
      onShellEnvFailed,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const firstPromise = service.resolve({ cwd: "/repo", source: "plugin" });
    // Give the first dump a chance to start, then invalidate.
    await Promise.resolve();
    await service.invalidate();
    releaseLoad();
    const first = await firstPromise;
    // Superseded dump must not repopulate success cache as /stale.
    expect(first.shellEnv).toEqual({});

    const second = await service.resolve({ cwd: "/repo", source: "plugin" });
    expect(second.env.PATH).toBe("/fresh");
    expect(second.shellEnv.PATH).toBe("/fresh");
    expect(onShellEnvFailed).not.toHaveBeenCalled();
  });

  it("parses null-separated env surrounded by shell startup noise", () => {
    const output = Buffer.concat([
      Buffer.from("startup noise\n__PIER_ENV_START__\n"),
      Buffer.from("PATH=/shell/bin\0BUN_INSTALL=/Users/dev/.bun\0"),
      Buffer.from("\n__PIER_ENV_END__\nmore noise"),
    ]);

    expect(parseShellEnvironmentOutput(output)).toEqual({
      BUN_INSTALL: "/Users/dev/.bun",
      PATH: "/shell/bin",
    });
  });
});

describe("applyHostProcessEnv", () => {
  it("applies whitelist keys and never applies DYLD/NODE_OPTIONS/ELECTRON_*", () => {
    const target: NodeJS.ProcessEnv = {
      PATH: "/old",
      STALE_NVM: "should-not-touch-unless-applied",
    };
    const result = applyHostProcessEnv(
      {
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: "plugin",
        },
        shellEnv: {
          DYLD_LIBRARY_PATH: "/evil",
          ELECTRON_RUN_AS_NODE: "1",
          NVM_DIR: "/Users/dev/.nvm",
          NODE_OPTIONS: "--inspect",
          PATH: "/shell/bin",
          SHLVL: "3",
        },
      },
      { targetEnv: target }
    );

    expect(target.PATH).toBe("/shell/bin");
    expect(target.NVM_DIR).toBe("/Users/dev/.nvm");
    expect(target.DYLD_LIBRARY_PATH).toBeUndefined();
    expect(target.NODE_OPTIONS).toBeUndefined();
    expect(target.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(target.SHLVL).toBeUndefined();
    expect(result.diagnosticsPatch.hostAppliedStatus).toBe("applied");
    expect(shouldApplyHostEnvKey("PATH")).toBe(true);
    expect(shouldApplyHostEnvKey("DYLD_LIBRARY_PATH")).toBe(false);
    expect(shouldApplyHostEnvKey("SHLVL")).toBe(false);
  });

  it("deletes previously applied keys missing from the new shell env", () => {
    const target: NodeJS.ProcessEnv = {
      NVM_BIN: "/old/nvm/bin",
      PATH: "/old",
    };
    const first = applyHostProcessEnv(
      {
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: "plugin",
        },
        shellEnv: {
          NVM_BIN: "/old/nvm/bin",
          PATH: "/shell/bin",
        },
      },
      { targetEnv: target }
    );

    applyHostProcessEnv(
      {
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: "plugin",
        },
        shellEnv: {
          PATH: "/shell/bin2",
        },
      },
      {
        lastAppliedKeys: first.lastAppliedKeys,
        targetEnv: target,
      }
    );

    expect(target.PATH).toBe("/shell/bin2");
    expect(target.NVM_BIN).toBeUndefined();
  });

  it("does not apply when shell env failed", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/keep" };
    const result = applyHostProcessEnv(
      {
        diagnostics: {
          cacheHit: false,
          error: "fail",
          pathChanged: false,
          shellEnvStatus: "failed",
          source: "plugin",
        },
        shellEnv: { PATH: "/would-apply" },
      },
      { targetEnv: target }
    );
    expect(target.PATH).toBe("/keep");
    expect(result.diagnosticsPatch.hostAppliedStatus).toBe("not-applied");
  });

  it("uses shellEnv not merged env keys for host apply", () => {
    const target: NodeJS.ProcessEnv = { PATH: "/old" };
    applyHostProcessEnv(
      {
        diagnostics: {
          cacheHit: false,
          pathChanged: true,
          shellEnvStatus: "resolved",
          source: "plugin",
        },
        // shell layer only — agent PATH must not be applied
        shellEnv: { PATH: "/shell/bin", NVM_DIR: "/nvm" },
      },
      { targetEnv: target }
    );
    expect(target.PATH).toBe("/shell/bin");
    expect(target.NVM_DIR).toBe("/nvm");
  });
});
