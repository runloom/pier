import { spawnBackgroundTask } from "@main/services/tasks/task-background-runner.ts";
import { describe, expect, it } from "vitest";

describe("task background runner", () => {
  it("forwards stdout and stderr with terminal control sequences intact", async () => {
    const output: Array<{ stream: "stdout" | "stderr"; text: string }> = [];
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      spawnBackgroundTask({
        command: "printf '\\033[31mout\\033[0m\\n'; printf 'err\\n' >&2",
        cwd: process.cwd(),
        env: {
          PATH: process.env.PATH ?? "",
          SHELL: "/bin/sh",
        },
        onError: reject,
        onExit: resolve,
        onOutput: (stream, text) => output.push({ stream, text }),
      });
    });

    expect(exitCode).toBe(0);
    expect(output).toContainEqual({
      stream: "stdout",
      text: "\u001B[31mout\u001B[0m\n",
    });
    expect(
      output.some(
        (chunk) => chunk.stream === "stderr" && chunk.text.includes("err\n")
      )
    ).toBe(true);
    expect(output.map((chunk) => chunk.text).join("")).toContain("\u001B");
  });
});
