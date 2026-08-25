import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { MarkdownPreview } from "@plugins/builtin/files/renderer/markdown/preview.tsx";
import {
  type MarkdownRuntime,
  paginateMarkdownDocument,
} from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// 复用 markdown-preview.test.tsx 的注入范式：真实 parse + 假 runtime。
function immediateRuntime(): MarkdownRuntime {
  return {
    closeSession: vi.fn(),
    dispose: vi.fn(),
    parse: vi.fn(async (input) => {
      const document = parseMarkdownToIr(input.source);
      return {
        document,
        pagination: paginateMarkdownDocument(document),
        revision: input.revision,
        status: "parsed" as const,
      };
    }),
    setSessionVisible: vi.fn(),
  };
}

describe("heading anchor copy", () => {
  it("copies <source path>#<heading id> through the anchor channel", async () => {
    const copyAnchor = vi.fn().mockResolvedValue(undefined);
    render(
      <MarkdownPreview
        copyAnchor={copyAnchor}
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="s1"
        source={{ kind: "disk", path: "/docs/a.md", root: "/docs" }}
        value={"# Hello World\n\nbody"}
      />
    );

    const button = await screen.findByRole("button", {
      name: "Copy heading anchor",
    });
    fireEvent.click(button);
    await waitFor(() =>
      expect(copyAnchor).toHaveBeenCalledWith("/docs/a.md#hello-world")
    );
  });

  it("omits the copy button when no disk source is available", async () => {
    render(
      <MarkdownPreview
        openExternal={vi.fn()}
        runtime={immediateRuntime()}
        sessionId="s2"
        value={"# Hello World\n\nbody"}
      />
    );

    await screen.findByRole("heading", { name: "Hello World" });
    expect(
      screen.queryByRole("button", { name: "Copy heading anchor" })
    ).toBeNull();
  });
});
