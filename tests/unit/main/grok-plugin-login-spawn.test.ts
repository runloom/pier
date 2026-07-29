import { describe, expect, it } from "vitest";
import { defaultSpawnLogin } from "../../../packages/plugin-grok/src/main/login-spawn.ts";

describe("defaultSpawnLogin", () => {
  it("includes the safe final CLI error instead of only the exit code", async () => {
    const controller = new AbortController();

    await expect(
      defaultSpawnLogin(
        process.execPath,
        [
          "-e",
          "console.error('\\u001b[31mThis account does not have Grok Build access\\u001b[0m'); process.exit(1)",
        ],
        {
          env: {},
          signal: controller.signal,
        }
      )
    ).rejects.toThrow(
      "Grok login failed (exit code 1): This account does not have Grok Build access"
    );
  });

  it("does not include token-bearing CLI output in the failure", async () => {
    const controller = new AbortController();
    let failure: Error | null = null;

    try {
      await defaultSpawnLogin(
        process.execPath,
        [
          "-e",
          "console.error('access_token=xai-secret-value'); process.exit(1)",
        ],
        {
          env: {},
          signal: controller.signal,
        }
      );
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
    }

    expect(failure?.message).toBe("Grok login exited with code 1");
    expect(failure?.message).not.toContain("xai-secret-value");
  });
});
