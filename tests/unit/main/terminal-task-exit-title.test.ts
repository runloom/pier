import { parseTaskExitTitle } from "@main/ipc/terminal-task-exit-title.ts";
import { TASK_EXIT_TITLE_PREFIX } from "@shared/contracts/tasks.ts";
import { describe, expect, it } from "vitest";

describe("terminal task exit title", () => {
  it("parses task exit titles", () => {
    expect(parseTaskExitTitle(`${TASK_EXIT_TITLE_PREFIX}2`)).toBe(2);
    expect(parseTaskExitTitle(`${TASK_EXIT_TITLE_PREFIX}-5`)).toBe(1);
    expect(parseTaskExitTitle("pier-task-exit:nope")).toBeNull();
  });

  it("does not parse ordinary terminal titles", () => {
    expect(parseTaskExitTitle("vim")).toBeNull();
  });
});
