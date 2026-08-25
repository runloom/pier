import {
  recallScrollPosition,
  rememberScrollPosition,
} from "@plugins/builtin/files/renderer/markdown/scroll-memory.ts";
import { beforeEach, describe, expect, it } from "vitest";

describe("scroll memory", () => {
  beforeEach(() => localStorage.clear());

  it("recalls position while source unchanged", () => {
    rememberScrollPosition({ sourcePath: "/m.md", source: "abc", top: 480 });
    expect(recallScrollPosition({ sourcePath: "/m.md", source: "abc" })).toBe(
      480
    );
  });

  it("drops memory when source changed", () => {
    rememberScrollPosition({ sourcePath: "/m.md", source: "abc", top: 480 });
    expect(
      recallScrollPosition({ sourcePath: "/m.md", source: "abcd" })
    ).toBeNull();
  });

  it("ignores zero-top captures (panel hidden guard)", () => {
    rememberScrollPosition({ sourcePath: "/z.md", source: "x", top: 0 });
    expect(
      recallScrollPosition({ sourcePath: "/z.md", source: "x" })
    ).toBeNull();
  });
});
