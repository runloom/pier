import { describe, expect, it } from "vitest";
import { findDispatchKind } from "@/lib/actions/view-actions.ts";

describe("findDispatchKind", () => {
  it("sends terminal panels to terminal search", () => {
    expect(findDispatchKind("terminal")).toBe("terminal");
  });

  it("sends files, git review, and search panels to panel find", () => {
    expect(findDispatchKind("pier.files.filePanel")).toBe("panel-find");
    expect(findDispatchKind("pier.files.groupView")).toBe("panel-find");
    expect(findDispatchKind("pier.files.searchPanel")).toBe("panel-find");
    expect(findDispatchKind("pier.git.changes")).toBe("panel-find");
  });

  it("returns null on panels without a find surface", () => {
    expect(findDispatchKind(undefined)).toBeNull();
    expect(findDispatchKind("welcome")).toBeNull();
  });
});
