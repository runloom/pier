import { revealMarkdownChange } from "@plugins/builtin/files/renderer/git-changes/markdown-reveal.ts";
import { describe, expect, it, vi } from "vitest";

describe("Markdown change navigation", () => {
  it("reveals the source page first, then its exact marker when lazy content mounts", async () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<section data-slot="markdown-page" data-source-line="20" data-source-end-line="80"></section>';
    const page = root.firstElementChild as HTMLElement;
    page.scrollIntoView = vi.fn();
    const stop = revealMarkdownChange(
      root,
      { id: "range-1", newLineFrom: 40 },
      vi.fn()
    );
    expect(page.scrollIntoView).toHaveBeenCalledWith({
      block: "nearest",
      inline: "nearest",
    });
    const marker = document.createElement("button");
    marker.dataset.gitChangeId = "range-1";
    marker.scrollIntoView = vi.fn();
    root.append(marker);
    await Promise.resolve();
    expect(marker.scrollIntoView).toHaveBeenCalledTimes(1);
    root.append(document.createElement("div"));
    await Promise.resolve();
    expect(marker.scrollIntoView).toHaveBeenCalledTimes(1);
    stop();
  });
});
