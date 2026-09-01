import {
  StatusStack,
  sortStatusStackItems,
  statusStackShellTone,
} from "@pier/ui/status-stack.tsx";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => cleanup());

describe("sortStatusStackItems", () => {
  it("orders destructive > warning > info > default and keeps stable order", () => {
    const sorted = sortStatusStackItems([
      { id: "d1", tone: "default", title: "D1" },
      { id: "i1", tone: "info", title: "I1" },
      { id: "w1", tone: "warning", title: "W1" },
      { id: "x1", tone: "destructive", title: "X1" },
      { id: "w2", tone: "warning", title: "W2" },
    ]);
    expect(sorted.map((i) => i.id)).toEqual(["x1", "w1", "w2", "i1", "d1"]);
  });
});

describe("statusStackShellTone", () => {
  it("picks highest tone", () => {
    expect(
      statusStackShellTone([
        { id: "a", tone: "info", title: "a" },
        { id: "b", tone: "warning", title: "b" },
      ])
    ).toBe("warning");
  });
});

describe("StatusStack", () => {
  it("returns null for empty items", () => {
    const { container } = render(<StatusStack items={[]} />);
    expect(container.querySelector('[data-slot="status-stack"]')).toBeNull();
  });

  it("renders one shell with multiple items and no nested alert slots", () => {
    render(
      <StatusStack
        items={[
          { id: "w", tone: "warning", title: "Warn", description: "W body" },
          { id: "i", tone: "info", title: "Info", description: "I body" },
        ]}
      />
    );
    const shells = document.querySelectorAll('[data-slot="status-stack"]');
    expect(shells).toHaveLength(1);
    expect(shells[0]).toHaveAttribute("data-shell-tone", "warning");
    expect(
      document.querySelectorAll('[data-slot="status-stack-item"]')
    ).toHaveLength(2);
    expect(document.querySelectorAll('[data-slot="alert"]')).toHaveLength(0);
    expect(screen.getByText("Warn")).toBeInTheDocument();
    expect(screen.getByText("Info")).toBeInTheDocument();
  });

  it("invokes dismiss handler", () => {
    const onDismiss = vi.fn();
    render(
      <StatusStack
        dismissLabel="Close"
        items={[
          {
            id: "x",
            tone: "info",
            title: "Hint",
            dismissible: true,
            onDismiss,
          },
        ]}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("preserves multiline description whitespace", () => {
    const { container } = render(
      <StatusStack
        items={[
          {
            id: "m",
            tone: "warning",
            title: "Issues",
            description: "Line A\nLine B",
          },
        ]}
      />
    );
    const desc = container.querySelector(
      '[data-slot="status-stack-item"] .whitespace-pre-wrap'
    );
    expect(desc?.textContent).toBe("Line A\nLine B");
  });

  it("renders title-only action on the same row", () => {
    const onClick = vi.fn();
    render(
      <StatusStack
        items={[
          {
            id: "a",
            tone: "warning",
            title: "Some agents are not connected.",
            action: { label: "View details", onClick },
          },
        ]}
      />
    );
    const item = screen
      .getByRole("button", { name: "View details" })
      .closest("[data-slot='status-stack-item']");
    expect(item).toHaveAttribute("data-compact-action", "true");
    expect(item?.className).toContain("grid-cols-[auto_minmax(0,1fr)_auto]");
    fireEvent.click(screen.getByRole("button", { name: "View details" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("keeps action in a footer row when description is present", () => {
    const onClick = vi.fn();
    render(
      <StatusStack
        items={[
          {
            action: { label: "Retry", onClick },
            description: "More detail",
            id: "a",
            title: "Broken",
            tone: "destructive",
          },
        ]}
      />
    );
    const action = screen.getByRole("button", { name: "Retry" });
    expect(
      action.closest('[data-slot="status-stack-item-action"]')?.className
    ).toContain("mt-2");
  });

  it("sizes the status icon to the first line and does not span later rows", () => {
    const { container } = render(
      <StatusStack
        items={[
          {
            action: { label: "Retry", onClick: vi.fn() },
            id: "w",
            title: "Some agents are not connected.",
            tone: "warning",
          },
        ]}
      />
    );
    const icon = container.querySelector("[data-slot='status-icon']");
    expect(icon).toHaveAttribute("data-size", "md");
    expect(icon?.className).toContain("size-[1lh]");
    expect(icon?.className).toContain("leading-5");
    const item = container.querySelector("[data-slot='status-stack-item']");
    expect(item?.className).toContain("items-center");
    expect(item?.className).toContain("leading-5");
    expect(item?.className).not.toContain("row-span-2");
    expect(item?.className).not.toContain("translate-y-0.5");
  });
});
