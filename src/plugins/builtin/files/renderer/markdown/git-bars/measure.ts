import type { MarkdownGitBarSourceBox } from "./map.ts";

const SOURCE_LINE_SELECTOR = "[data-source-line]";
const BOX_PX_EPSILON = 0.5;

function readSourceLine(element: HTMLElement, key: string): number | null {
  const raw = element.dataset[key];
  if (raw === undefined || raw.length === 0) {
    return null;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1 ? value : null;
}

function boxFromElement(
  element: HTMLElement,
  scrollRoot: HTMLElement
): MarkdownGitBarSourceBox | null {
  const startLine = readSourceLine(element, "sourceLine");
  if (startLine === null) {
    return null;
  }
  const endLine = readSourceLine(element, "sourceEndLine") ?? startLine;
  const rootRect = scrollRoot.getBoundingClientRect();
  const rect = element.getBoundingClientRect();
  return {
    endLine: Math.max(startLine, endLine),
    height: Math.max(0, rect.height),
    startLine,
    top: rect.top - rootRect.top + scrollRoot.scrollTop,
  };
}

export function isUnrenderedMarkdownPage(page: HTMLElement): boolean {
  return page.dataset.markdownPageRendered === "false";
}

/**
 * Innermost source-line nodes inside a page. Nested lists/blockquotes keep
 * the leaf block so a one-line edit does not paint the whole outer list.
 * Unrendered lazy pages are skipped — their estimated min-height is not a
 * geometry source (bars appear at true size once the page intersects).
 */
export function selectGitBarSourceElements(page: HTMLElement): HTMLElement[] {
  if (isUnrenderedMarkdownPage(page)) {
    return [];
  }
  const inner = Array.from(
    page.querySelectorAll<HTMLElement>(SOURCE_LINE_SELECTOR)
  );
  if (inner.length === 0) {
    return page.matches(SOURCE_LINE_SELECTOR) ? [page] : [];
  }
  return inner.filter(
    (element) => element.querySelector(SOURCE_LINE_SELECTOR) === null
  );
}

export function measureMarkdownGitBarBoxes(
  scrollRoot: HTMLElement
): MarkdownGitBarSourceBox[] {
  const pages = scrollRoot.querySelectorAll<HTMLElement>(
    '[data-slot="markdown-page"]'
  );
  const boxes: MarkdownGitBarSourceBox[] = [];
  const roots =
    pages.length > 0 ? Array.from(pages) : ([scrollRoot] as HTMLElement[]);
  for (const root of roots) {
    for (const element of selectGitBarSourceElements(root)) {
      const box = boxFromElement(element, scrollRoot);
      if (box) {
        boxes.push(box);
      }
    }
  }
  return boxes;
}

export function markdownGitBarBoxesEqual(
  left: readonly MarkdownGitBarSourceBox[],
  right: readonly MarkdownGitBarSourceBox[]
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index];
    const b = right[index];
    if (!(a && b)) {
      return false;
    }
    if (
      a.startLine !== b.startLine ||
      a.endLine !== b.endLine ||
      Math.abs(a.top - b.top) > BOX_PX_EPSILON ||
      Math.abs(a.height - b.height) > BOX_PX_EPSILON
    ) {
      return false;
    }
  }
  return true;
}
