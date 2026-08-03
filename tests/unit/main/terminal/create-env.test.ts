import { resolveRestoredAgentLaunchEnv } from "@main/ipc/terminal/create-env.ts";
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
