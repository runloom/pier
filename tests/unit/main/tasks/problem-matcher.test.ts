import {
  createProblemMatcher,
  matchProblemLines,
} from "@main/services/tasks/problem-matcher.ts";

const WATCHING_RE = /watching/;
const DONE_RE = /done/;

import { describe, expect, it } from "vitest";

describe("problem matcher", () => {
  it("matches single-line VS Code problem patterns", () => {
    const matcher = createProblemMatcher({
      pattern: {
        column: 3,
        file: 1,
        line: 2,
        message: 4,
        regexp: "^(.+):(\\d+):(\\d+):\\s+(.*)$",
      },
    });

    expect(
      matchProblemLines(matcher, ["src/app.ts:3:10: Cannot find name"])
    ).toEqual([
      {
        column: 10,
        file: "src/app.ts",
        line: 3,
        message: "Cannot find name",
      },
    ]);
  });

  it("matches multi-line VS Code problem patterns", () => {
    const matcher = createProblemMatcher({
      pattern: [
        {
          file: 1,
          regexp: "^File (.+)$",
        },
        {
          line: 1,
          message: 2,
          regexp: "^Line (\\d+): (.+)$",
        },
      ],
    });

    expect(
      matchProblemLines(matcher, ["File src/app.ts", "Line 9: broken"])
    ).toEqual([
      {
        file: "src/app.ts",
        line: 9,
        message: "broken",
      },
    ]);
  });

  it("keeps background matcher metadata", () => {
    const matcher = createProblemMatcher({
      background: {
        activeOnStart: true,
        beginsPattern: "watching",
        endsPattern: "done",
      },
      pattern: {
        file: 1,
        message: 2,
        regexp: "^(.+): (.+)$",
      },
    });

    expect(matcher.background).toEqual({
      activeOnStart: true,
      beginsPattern: WATCHING_RE,
      endsPattern: DONE_RE,
    });
  });
});
