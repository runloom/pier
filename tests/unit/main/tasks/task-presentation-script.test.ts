import { buildTaskPresentationScript } from "@main/services/tasks/presentation-script.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

describe("task presentation script", () => {
  it("disables posix errexit so a failing command still writes the OSC trailer", () => {
    const script = buildTaskPresentationScript({
      command: "false",
      family: "zsh",
      presentation: { showSummary: true },
    });
    expect(script.startsWith("set +e; ")).toBe(true);
    expect(script).toContain("false");
    expect(script).toContain("code=$?");
    expect(script).toContain(TASK_EXIT_TITLE_PREFIX);
    expect(script).toContain('exit "$code"');
    expect(script).toContain("[pier] task exited with");
  });

  it("uses fish status instead of set +e / $?", () => {
    const script = buildTaskPresentationScript({
      command: "pnpm test",
      family: "fish",
      presentation: { clear: true, showCommand: true },
    });
    expect(script).not.toContain("set +e");
    expect(script).not.toContain("$?");
    expect(script.startsWith("clear; ")).toBe(true);
    expect(script).toContain("set code $status");
    expect(script).toContain(TASK_EXIT_TITLE_PREFIX);
    expect(script).toContain("exit $code");
  });

  it("uses nu LAST_EXIT_CODE instead of posix trailer syntax", () => {
    const script = buildTaskPresentationScript({
      command: "pnpm test",
      family: "nu",
      presentation: {},
    });
    expect(script).not.toContain("set +e");
    expect(script).toContain("let code = $env.LAST_EXIT_CODE");
    expect(script).toContain(TASK_EXIT_TITLE_PREFIX);
    expect(script).toContain("exit $code");
  });
});
