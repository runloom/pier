import { parseMarkdownToIr } from "@plugins/builtin/files/renderer/markdown/parser.ts";
import { MarkdownPreview } from "@plugins/builtin/files/renderer/markdown/preview.tsx";
import {
  type MarkdownRuntime,
  paginateMarkdownDocument,
} from "@plugins/builtin/files/renderer/markdown/runtime.ts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const source = { kind: "disk" as const, path: "docs/readme.md", root: "/repo" };
const value = ["Text[^1]", "", "[^1]: The footnote body."].join("\n");

function renderPreview() {
  return render(
    <MarkdownPreview
      openExternal={vi.fn()}
      runtime={immediateRuntime()}
      sessionId="markdown-footnote-popover"
      source={source}
      value={value}
    />
  );
}

describe("markdown footnote reference popover", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    // jsdom has no native implementation; drop the test-assigned stub.
    (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView =
      undefined;
  });

  it("shows the definition content while hovering the reference", async () => {
    const { container } = renderPreview();
    await screen.findByText("Text");

    const sup = container.querySelector<HTMLElement>(
      "sup > a.md-link[href='#footnote-1']"
    )?.parentElement;
    expect(sup).not.toBeNull();

    fireEvent.mouseEnter(sup as HTMLElement);
    expect(await screen.findByRole("tooltip")).toHaveTextContent(
      "The footnote body."
    );
  });

  it("removes the popover on mouse leave", async () => {
    const { container } = renderPreview();
    await screen.findByText("Text");

    const sup = container.querySelector<HTMLElement>(
      "sup > a.md-link[href='#footnote-1']"
    )?.parentElement;
    expect(sup).not.toBeNull();

    fireEvent.mouseEnter(sup as HTMLElement);
    expect(await screen.findByRole("tooltip")).toBeVisible();
    fireEvent.mouseLeave(sup as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("tooltip")).toBeNull());
  });

  it("still jumps to the definition when clicked", async () => {
    const { container } = renderPreview();
    await screen.findByText("Text");

    const link = container.querySelector<HTMLAnchorElement>(
      "sup > a.md-link[href='#footnote-1']"
    );
    expect(link).not.toBeNull();

    // jsdom does not implement scrollIntoView; the jump path calls it
    // optionally on the resolved anchor target.
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    expect(fireEvent.click(link as HTMLAnchorElement)).toBe(false);
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(scrollIntoView.mock.contexts[0]).toHaveAttribute("id", "footnote-1");
  });
});
