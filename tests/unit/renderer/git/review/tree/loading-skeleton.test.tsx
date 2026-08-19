import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { ReviewTreeLoading } from "@plugins/builtin/git/renderer/review/feedback.tsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

const context = {
  i18n: {
    t: (_key: string, _values?: unknown, fallback = "") => fallback,
  },
} as unknown as RendererPluginContext;

afterEach(() => {
  cleanup();
});

describe("ReviewTreeLoading", () => {
  it("exposes status and uses sidebar-foreground bars (not bg-muted)", () => {
    const { container } = render(<ReviewTreeLoading context={context} />);
    expect(
      screen.getByRole("status", { name: "Loading changed files" })
    ).toBeVisible();
    expect(
      container.querySelector('[data-testid="git-review-tree-loading"]')
    ).toBeTruthy();
    const html = container.innerHTML;
    // sidebar 底色 = muted：必须用 foreground 淡色，否则看不见
    expect(html).toContain("bg-sidebar-foreground/");
    expect(html).not.toMatch(/data-slot="skeleton"[^>]*bg-muted(?!-)/u);
  });
});
