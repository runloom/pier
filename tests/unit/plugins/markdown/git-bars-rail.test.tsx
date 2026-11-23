import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { FileChangeSurfaceContext } from "@plugins/builtin/files/renderer/git-changes/context.ts";
import { GUTTER_TOOLTIP_DELAY_MS } from "@plugins/builtin/files/renderer/git-changes/hover-tooltip.tsx";
import type { FileChangesSnapshot } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { MarkdownPreviewGitBars } from "@plugins/builtin/files/renderer/markdown/git-bars/rail.tsx";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useState } from "react";
import { describe, expect, it, vi } from "vitest";

function scrollFixture() {
  const root = document.createElement("div");
  root.innerHTML =
    '<div data-slot="markdown-prose"><p data-source-line="1" data-source-end-line="3">new</p></div>';
  const rect = {
    top: 0,
    bottom: 60,
    left: 0,
    right: 500,
    width: 500,
    height: 60,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  };
  root.getBoundingClientRect = () => rect;
  const paragraph = root.querySelector("p");
  if (paragraph) paragraph.getBoundingClientRect = () => rect;
  document.body.append(root);
  return root;
}
function longAdditionFixture() {
  const after = `${Array.from({ length: 127 }, (_, index) => `line ${index + 1}`).join("\n")}\n`;
  return {
    after,
    snapshot: {
      ...compareFileContents({
        path: "a.md",
        before: "",
        after,
        version: 4,
      }),
      version: 4,
      status: "ready",
      contents: after,
      baseline: "",
      dirty: true,
      headOid: "head",
    } satisfies FileChangesSnapshot,
  };
}

const LONG_VIEWPORT = {
  top: 0,
  bottom: 600,
  left: 0,
  right: 500,
  width: 500,
  height: 600,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};
const LONG_CONTENT = {
  top: 0,
  bottom: 4000,
  left: 0,
  right: 500,
  width: 500,
  height: 4000,
  x: 0,
  y: 0,
  toJSON: () => ({}),
};

function LongGitBarsFixture({ after }: { readonly after: string }) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const attach = useCallback((node: HTMLDivElement | null) => {
    if (node) {
      node.getBoundingClientRect = () => LONG_VIEWPORT;
      const paragraph = node.querySelector("p");
      if (paragraph) paragraph.getBoundingClientRect = () => LONG_CONTENT;
    }
    setRoot(node);
  }, []);
  return (
    <div
      data-testid="long-git-bars-root"
      ref={attach}
      style={{ position: "relative" }}
    >
      <div data-slot="markdown-prose">
        <p data-source-end-line="127" data-source-line="1">
          new
        </p>
      </div>
      <MarkdownPreviewGitBars
        contents={after}
        context={undefined}
        ready
        scrollRoot={root}
      />
    </div>
  );
}

const snapshot: FileChangesSnapshot = {
  ...compareFileContents({
    path: "a.md",
    before: "old\n",
    after: "new\n",
    version: 3,
  }),
  version: 3,
  status: "ready",
  contents: "new\n",
  baseline: "old\n",
  dirty: true,
  headOid: "head",
};
describe("Markdown local diff bars", () => {
  it("opens the exact range identity without inferring a line from pixels", async () => {
    const root = scrollFixture();
    const openRange = vi.fn();
    const ui = render(
      <TooltipProvider>
        <FileChangeSurfaceContext value={{ snapshot, openRange }}>
          <MarkdownPreviewGitBars
            contents={"new\n"}
            context={undefined}
            ready
            scrollRoot={root}
          />
        </FileChangeSurfaceContext>
      </TooltipProvider>
    );
    const button = await screen.findByRole("button", { name: /edited change/ });
    fireEvent.click(button, { clientY: 59 });
    expect(openRange).toHaveBeenCalledWith(snapshot.ranges[0]?.id);
    expect(button.tabIndex).toBe(-1);
    ui.unmount();
    root.remove();
  });
  it("anchors the delayed hint at the pointer rather than the range center", async () => {
    const { after, snapshot: longSnapshot } = longAdditionFixture();
    const ui = render(
      <TooltipProvider>
        <FileChangeSurfaceContext
          value={{ snapshot: longSnapshot, openRange: vi.fn() }}
        >
          <LongGitBarsFixture after={after} />
        </FileChangeSurfaceContext>
      </TooltipProvider>
    );
    const button = await screen.findByRole("button", { name: /added change/ });
    expect(button).toHaveAccessibleName(/1–127/);
    button.getBoundingClientRect = () => ({
      ...LONG_CONTENT,
      right: 16,
      width: 16,
    });
    vi.useFakeTimers();
    try {
      fireEvent.pointerOver(button, { clientY: 258 });
      act(() => {
        vi.advanceTimersByTime(GUTTER_TOOLTIP_DELAY_MS - 1);
      });
      expect(
        document.querySelector('[data-slot="gutter-hover-tooltip-anchor"]')
      ).toBeNull();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      const anchor = document.querySelector<HTMLElement>(
        '[data-slot="gutter-hover-tooltip-anchor"]'
      );
      expect(anchor).not.toBeNull();
      expect(anchor).toHaveStyle({
        height: "16px",
        left: "0px",
        top: "250px",
        width: "16px",
      });
      expect(screen.getByRole("tooltip")).toHaveTextContent("View changes");
      expect(screen.getByRole("tooltip")).not.toHaveTextContent("127");
      fireEvent.pointerOut(button, { relatedTarget: document.body });
      expect(
        document.querySelector('[data-slot="gutter-hover-tooltip-anchor"]')
      ).toBeNull();
      fireEvent.pointerOver(button, { clientY: 258 });
      act(() => {
        vi.advanceTimersByTime(GUTTER_TOOLTIP_DELAY_MS);
      });
      expect(
        document.querySelector('[data-slot="gutter-hover-tooltip-anchor"]')
      ).not.toBeNull();
      fireEvent.scroll(screen.getByTestId("long-git-bars-root"));
      expect(
        document.querySelector('[data-slot="gutter-hover-tooltip-anchor"]')
      ).toBeNull();
    } finally {
      vi.useRealTimers();
      ui.unmount();
    }
  });
  it("hides bars while Markdown's rendered source belongs to an older revision", async () => {
    const root = scrollFixture();
    const ui = render(
      <TooltipProvider>
        <FileChangeSurfaceContext value={{ snapshot, openRange: vi.fn() }}>
          <MarkdownPreviewGitBars
            contents={"older\n"}
            context={undefined}
            ready
            scrollRoot={root}
          />
        </FileChangeSurfaceContext>
      </TooltipProvider>
    );
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /edited change/ })).toBeNull()
    );
    ui.unmount();
    root.remove();
  });
});
