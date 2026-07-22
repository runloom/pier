import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MentionPopup } from "@/panel-kits/terminal/structured-composer/mention-popup.tsx";

describe("MentionPopup", () => {
  it("shows empty-project guidance when no project root", () => {
    render(
      <MentionPopup
        activeIndex={0}
        emptyProject
        emptyProjectBody="Open a project folder first to mention files with @."
        emptyProjectTitle="No project open"
        items={[]}
        noResults="No matching files"
        onHover={vi.fn()}
        onSelect={vi.fn()}
        placeholder="Mention a file or folder…"
        status="done"
      />
    );
    expect(screen.getByText("No project open")).toBeVisible();
    expect(
      screen.getByText("Open a project folder first to mention files with @.")
    ).toBeVisible();
  });

  it("selects a path on mousedown", () => {
    const onSelect = vi.fn();
    render(
      <MentionPopup
        activeIndex={0}
        emptyProject={false}
        emptyProjectBody=""
        emptyProjectTitle=""
        items={[
          { path: "src/a.ts", score: 1 },
          { path: "src", score: 0.5 },
        ]}
        noResults="No matching files"
        onHover={vi.fn()}
        onSelect={onSelect}
        placeholder="Mention a file or folder…"
        status="done"
      />
    );
    expect(screen.getAllByText("a.ts").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("src").length).toBeGreaterThanOrEqual(1);
    fireEvent.mouseDown(screen.getByTestId("terminal-composer-mention-item-0"));
    expect(onSelect).toHaveBeenCalledWith(0);
  });

  it("hides the scrollbar chrome", () => {
    const { container } = render(
      <MentionPopup
        activeIndex={0}
        emptyProject={false}
        emptyProjectBody=""
        emptyProjectTitle=""
        items={[{ path: "README.md", score: 1 }]}
        noResults="No matching files"
        onHover={vi.fn()}
        onSelect={vi.fn()}
        placeholder="Mention a file or folder…"
        status="done"
      />
    );
    const popup = container.querySelector(
      "[data-testid='terminal-composer-mention-popup']"
    );
    expect(popup).toHaveAttribute("data-scrollbar", "none");
    expect(popup?.className).toContain("no-scrollbar");
  });

  it("renders file-tree icons for each path", () => {
    const { container } = render(
      <MentionPopup
        activeIndex={0}
        emptyProject={false}
        emptyProjectBody=""
        emptyProjectTitle=""
        items={[
          { path: "LICENSE", score: 1 },
          { path: "src/a.ts", score: 0.5 },
        ]}
        noResults="No matching files"
        onHover={vi.fn()}
        onSelect={vi.fn()}
        placeholder="Mention a file or folder…"
        status="done"
      />
    );
    expect(
      container.querySelector('[data-pier-file-icon="LICENSE"]')
    ).not.toBeNull();
    expect(
      container.querySelector('[data-pier-file-icon="a.ts"]')
    ).not.toBeNull();
  });
});
