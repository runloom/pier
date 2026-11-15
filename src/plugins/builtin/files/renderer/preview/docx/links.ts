function safeExternalUrl(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "mailto:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** docx-preview emits raw w:anchor values; `%` is legal and not an escape. */
function decodeAnchor(fragment: string): string {
  try {
    return decodeURIComponent(fragment);
  } catch {
    return fragment;
  }
}

export function bindDocxLinks(
  root: ShadowRoot,
  options: {
    openExternal: (url: string) => void;
    scrollToAnchor: (id: string) => void;
  }
): () => void {
  const handleClick = (event: Event) => {
    const target = event.target;
    if (!(target instanceof Element)) {
      return;
    }
    const anchor = target.closest("a");
    if (!(anchor && root.contains(anchor))) {
      return;
    }
    event.preventDefault();
    const href = anchor.getAttribute("href")?.trim();
    if (!href) {
      return;
    }
    if (href.startsWith("#")) {
      options.scrollToAnchor(decodeAnchor(href.slice(1)));
      return;
    }
    const url = safeExternalUrl(href);
    if (url) {
      options.openExternal(url);
    }
  };
  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
}
