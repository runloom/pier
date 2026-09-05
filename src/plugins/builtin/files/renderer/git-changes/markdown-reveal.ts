import type { FileChangeRange } from "./types.ts";

/** Source ranges locate lazy pages; only stable IDs locate the final marker. */
export function revealMarkdownChange(
  root: HTMLElement,
  range: Pick<FileChangeRange, "id" | "newLineFrom">,
  onOutside: () => void
): () => void {
  const findMarker = () =>
    root.querySelector<HTMLElement>(
      `[data-git-change-id="${CSS.escape(range.id)}"]`
    );
  const nearest = { block: "nearest", inline: "nearest" } as const;
  let revealed = false;
  const reveal = () => {
    const marker = findMarker();
    if (!revealed && marker) {
      revealed = true;
      marker.scrollIntoView(nearest);
    }
  };
  if (!findMarker()) {
    const pages = [
      ...root.querySelectorAll<HTMLElement>('[data-slot="markdown-page"]'),
    ];
    const page =
      pages.find(
        (node) => Number(node.dataset.sourceEndLine) >= range.newLineFrom
      ) ?? pages.at(-1);
    page?.scrollIntoView(nearest);
  }
  reveal();
  const mounts = new MutationObserver(reveal);
  mounts.observe(root, { childList: true, subtree: true });
  const scroll = () => {
    const marker = findMarker();
    if (!(marker && revealed)) return;
    const bounds = root.getBoundingClientRect();
    const box = marker.getBoundingClientRect();
    if (box.bottom < bounds.top || box.top > bounds.bottom) onOutside();
  };
  root.addEventListener("scroll", scroll, true);
  return () => {
    mounts.disconnect();
    root.removeEventListener("scroll", scroll, true);
  };
}
