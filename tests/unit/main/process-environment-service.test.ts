import {
  createProcessEnvironmentService,
  parseShellEnvironmentOutput,
} from "@main/services/process-environment-service.ts";
import { afterEach, describe, expect, it, vi } from "vitest";

const ABSOLUTE_SHELL_RE = /^\//;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("process environment service", () => {
  it("merges process, shell, CLI, profile and explicit env by precedence", async () => {
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
        clientEnv: { FROM_CLI: "cli", PATH: "/cli/bin" },
        cwd: "/Users/dev/ABC/pier",
        explicitEnv: { FROM_EXPLICIT: "explicit", PATH: "/explicit/bin" },
        profileEnv: { FROM_PROFILE: "profile", PATH: "/profile/bin" },
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
        FROM_CLI: "cli",
        FROM_EXPLICIT: "explicit",
        FROM_PROFILE: "profile",
        FROM_SHELL: "shell",
        PATH: "/explicit/bin",
      },
    });
  });

  it("caches shell env by cwd, shell and source", async () => {
    const loadShellEnv = vi.fn(async () => ({
      env: { PATH: "/shell/bin" },
      status: "resolved" as const,
    }));
    const service = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv,
      platform: "darwin",
      shell: "/bin/zsh",
    });

    await service.resolve({ cwd: "/repo", source: "terminal" });
    const second = await service.resolve({ cwd: "/repo", source: "terminal" });
    await service.resolve({ cwd: "/repo", source: "task" });

    expect(loadShellEnv).toHaveBeenCalledTimes(2);
    expect(second.diagnostics).toMatchObject({
      cacheHit: true,
      shellEnvStatus: "cached",
    });
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

    await service.resolve({ cwd: "/repo", source: "terminal" });

    expect(loadShellEnv).toHaveBeenCalledWith(
      expect.objectContaining({
        cwd: "/repo",
        shell: expect.stringMatching(ABSOLUTE_SHELL_RE),
        source: "terminal",
      })
    );
  });

  it("falls back to non-shell env when shell loading fails", async () => {
    const service = createProcessEnvironmentService({
      baseEnv: { BASE_ONLY: "base", PATH: "/app/bin" },
      loadShellEnv: () => Promise.reject(new Error("shell failed")),
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
