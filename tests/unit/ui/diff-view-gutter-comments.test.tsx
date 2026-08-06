import {
  driftChipLabel,
  type PierDriftCommentLabels,
} from "@pier/ui/diff-view/gutter/gutter-comments.tsx";
import type { PierDiffReviewDriftThread } from "@pier/ui/diff-view/items.ts";
import { describe, expect, it } from "vitest";

const LABELS: PierDriftCommentLabels = {
  driftedLineComment: "Comment on line {{line}} can no longer be located",
  driftedLineLabel: "Line {{line}}",
  fileComment: "File comment",
  fileLabel: "File comment",
  sectionHeading: "Code changed",
};

function makeDriftThread(opts: {
  line?: number;
  side?: "additions" | "deletions";
  threadId?: string;
}): PierDiffReviewDriftThread {
  return {
    ...(opts.line === undefined ? {} : { line: opts.line }),
    ...(opts.side === undefined ? {} : { side: opts.side }),
    threadId: opts.threadId ?? "t1",
  };
}

describe("driftChipLabel", () => {
  it("renders a drifted line comment with the line number", () => {
    const label = driftChipLabel(makeDriftThread({ line: 5 }), LABELS);
    expect(label).toBe("Comment on line 5 can no longer be located");
  });

  it("renders a file comment without line", () => {
    const label = driftChipLabel(makeDriftThread({}), LABELS);
    expect(label).toBe("File comment");
  });

  it("ignores side when line is present", () => {
    const label = driftChipLabel(
      makeDriftThread({ line: 7, side: "deletions" }),
      LABELS
    );
    expect(label).toBe("Comment on line 7 can no longer be located");
  });
});
