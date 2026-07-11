import type { ResolvedTheme } from "@shared/contracts/preferences.ts";
import { NATIVE_CHROME_FALLBACK } from "@shared/theme-colors.ts";

function ensureMetaTag(): HTMLMetaElement {
  let meta = document.querySelector<HTMLMetaElement>(
    'meta[name="theme-color"]'
  );
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  return meta;
}

function readBackgroundColor(): string | null {
  if (
    typeof document === "undefined" ||
    typeof getComputedStyle === "undefined"
  ) {
    return null;
  }
  const computed = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  if (computed.length > 0) {
    return computed;
  }
  const inline = document.documentElement.style
    .getPropertyValue("--background")
    .trim();
  return inline.length > 0 ? inline : null;
}

export function syncThemeHead({ resolved }: { resolved: ResolvedTheme }): void {
  if (typeof document === "undefined") {
    return;
  }
  const meta = ensureMetaTag();
  const color = readBackgroundColor() ?? NATIVE_CHROME_FALLBACK[resolved];
  meta.setAttribute("content", color);
}
