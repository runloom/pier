import { loadMarkdownDiffDocuments } from "@plugins/builtin/files/renderer/git-changes/markdown/documents.ts";
import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import type { MarkdownRuntime } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { paginateMarkdownDocument } from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { describe, expect, it, vi } from "vitest";

function runtime(): MarkdownRuntime {
  return {
    parse: vi.fn<MarkdownRuntime["parse"]>(async (input) => {
      const document = parseMarkdownToIr(input.source);
      return {
        status: "parsed",
        revision: input.revision,
        document,
        pagination: paginateMarkdownDocument(document),
      };
    }),
    closeSession: vi.fn(),
    dispose: vi.fn(),
    setSessionVisible: vi.fn(),
  };
}
describe("Markdown diff parse ownership", () => {
  it("reuses a completed pair across opens without another Worker parse", async () => {
    const owner = {};
    const parser = runtime();
    const first = await loadMarkdownDiffDocuments(
      owner,
      "# Old",
      "# New",
      parser
    );
    const second = await loadMarkdownDiffDocuments(
      owner,
      "# Old",
      "# New",
      parser
    );
    expect(first).toBe(second);
    expect(first.before.headings[0]?.text).toBe("Old");
    expect(first.after.headings[0]?.text).toBe("New");
    expect(parser.parse).toHaveBeenCalledTimes(2);
    expect(parser.closeSession).toHaveBeenCalledTimes(2);
  });
  it("invalidates the pair when current contents change and separates owner sessions", async () => {
    const owner = {};
    const parser = runtime();
    await loadMarkdownDiffDocuments(owner, "# Old", "# First", parser);
    const latest = await loadMarkdownDiffDocuments(
      owner,
      "# Old",
      "# Second",
      parser
    );
    await loadMarkdownDiffDocuments({}, "# Old", "# Second", parser);
    expect(latest.after.headings[0]?.text).toBe("Second");
    expect(parser.parse).toHaveBeenCalledTimes(6);
    const sessions = vi
      .mocked(parser.parse)
      .mock.calls.map(([input]) => input.sessionId);
    expect(new Set(sessions).size).toBe(6);
    expect(vi.mocked(parser.closeSession).mock.calls.flat().sort()).toEqual(
      sessions.sort()
    );
  });
  it("does not cache a failed parse and releases both sessions", async () => {
    const owner = {};
    const parser = runtime();
    vi.mocked(parser.parse).mockResolvedValueOnce({
      status: "error",
      code: "worker-failed",
      revision: "old",
    });
    await expect(
      loadMarkdownDiffDocuments(owner, "# Old", "# New", parser)
    ).rejects.toThrow();
    const retried = await loadMarkdownDiffDocuments(
      owner,
      "# Old",
      "# New",
      parser
    );
    expect(retried.after.headings[0]?.text).toBe("New");
    expect(parser.closeSession).toHaveBeenCalledTimes(4);
  });
});
