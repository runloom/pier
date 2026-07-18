import {
  filePathQueryStartSchema,
  fileQueryEventSchema,
} from "@shared/contracts/file-query.ts";
import { expect, it } from "vitest";

it("accepts a path query start payload", () => {
  const parsed = filePathQueryStartSchema.parse({
    queryId: "q1",
    owner: "quick-open:1",
    root: "/repo",
    query: "theme.ts",
    limit: 200,
    mruPaths: ["src/main/ipc/theme.ts"],
    options: { applyGitIgnore: true, applyExcludePatterns: true },
  });
  expect(parsed.limit).toBe(200);
});

it("accepts done event", () => {
  expect(
    fileQueryEventSchema.parse({
      kind: "done",
      queryId: "q1",
      reason: "completed",
      truncated: false,
      scanned: 10,
      elapsedMs: 12,
    }).kind
  ).toBe("done");
});
