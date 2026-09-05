import { TooltipProvider } from "@pier/ui/tooltip.tsx";
import { compareFileContents } from "@plugins/builtin/files/renderer/git-changes/compare.ts";
import { FileChangeSurfaceContext } from "@plugins/builtin/files/renderer/git-changes/context.ts";
import type { FileChangesSnapshot } from "@plugins/builtin/files/renderer/git-changes/types.ts";
import { MarkdownPreviewGitBars } from "@plugins/builtin/files/renderer/markdown/git-bars/rail.tsx";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
