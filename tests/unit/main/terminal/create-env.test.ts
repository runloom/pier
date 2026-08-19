import {
  hydrateNativeLaunchEnv,
  resolveRestoredAgentLaunchEnv,
} from "@main/ipc/terminal/create-env.ts";
import { createProcessEnvironmentService } from "@main/services/process-environment-service.ts";
import { describe, expect, it } from "vitest";

describe("resolveRestoredAgentLaunchEnv", () => {
  it("preserves prior launch secrets as agentEnv under shell PATH", async () => {
    const processEnvironment = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => ({
        env: { PATH: "/shell/bin", NVM_DIR: "/nvm" },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await resolveRestoredAgentLaunchEnv(
      {
        command: "claude",
        cwd: "/repo",
        env: { OPENAI_API_KEY: "sk-restored", PATH: "/agent/bin" },
      },
      processEnvironment,
      { projectEnv: { PIER_ENV: "proj" } }
    );

    expect(result?.command).toBe("claude");
    expect(result?.cwd).toBe("/repo");
    expect(result?.env).toMatchObject({
      NVM_DIR: "/nvm",
      OPENAI_API_KEY: "sk-restored",
      PATH: "/agent/bin",
      PIER_ENV: "proj",
    });
  });

  it("injects shell PATH + projectEnv when prior env is absent", async () => {
    const processEnvironment = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => ({
        env: { PATH: "/shell/bin" },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await resolveRestoredAgentLaunchEnv(
      { command: "claude", cwd: "/repo" },
      processEnvironment,
      { projectEnv: { PIER_ENV: "proj" } }
    );

    expect(result?.env).toMatchObject({
      PATH: "/shell/bin",
      PIER_ENV: "proj",
    });
    expect(result?.env?.OPENAI_API_KEY).toBeUndefined();
  });

  it("does not drop non-env launch fields", async () => {
    const processEnvironment = createProcessEnvironmentService({
      baseEnv: { PATH: "/app" },
      loadShellEnv: async () => ({
        env: { PATH: "/shell" },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await resolveRestoredAgentLaunchEnv(
      {
        agentId: "claude",
        command: "claude --resume x",
        cwd: "/repo",
      },
      processEnvironment
    );

    expect(result).toMatchObject({
      agentId: "claude",
      command: "claude --resume x",
      cwd: "/repo",
    });
  });
});

describe("hydrateNativeLaunchEnv", () => {
  it("gives UI prepareLaunch the login-shell exports a blank terminal would see", async () => {
    const processEnvironment = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => ({
        env: {
          ANTHROPIC_AUTH_TOKEN: "sk-from-zshrc",
          ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
          PATH: "/shell/bin",
        },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });

    const result = await hydrateNativeLaunchEnv(
      {
        agentId: "claude",
        command: "claude",
        cwd: "/repo",
        env: { PATH: "/tmux/bin:/app/bin" },
      },
      processEnvironment
    );

    expect(result?.env).toMatchObject({
      ANTHROPIC_AUTH_TOKEN: "sk-from-zshrc",
      ANTHROPIC_BASE_URL: "https://api.example.test/anthropic",
      PATH: "/tmux/bin:/app/bin",
    });
  });

  it("layers project env and does not mutate the logical launch", async () => {
    const processEnvironment = createProcessEnvironmentService({
      baseEnv: { PATH: "/app/bin" },
      loadShellEnv: async () => ({
        env: { PATH: "/shell/bin" },
        status: "resolved",
      }),
      platform: "darwin",
      shell: "/bin/zsh",
    });
    const logical = { command: "claude", cwd: "/repo" };
    const localEnvironments = {
      resolveForWorktree: async () => ({
        project: {
          cleanupCommand: "",
          copyPatterns: [],
          env: { PIER_ENV: "proj" },
          kind: "project" as const,
          projectRootPath: "/repo",
          setupCommand: "",
          updatedAt: 0,
        },
        projectRootPath: "/repo",
      }),
      resolveProject: async () => null,
    };

    const result = await hydrateNativeLaunchEnv(logical, processEnvironment, {
      localEnvironments,
    });

    expect(logical).toEqual({ command: "claude", cwd: "/repo" });
    expect(result?.env).toMatchObject({
      PATH: "/shell/bin",
      PIER_ENV: "proj",
    });
  });
});
