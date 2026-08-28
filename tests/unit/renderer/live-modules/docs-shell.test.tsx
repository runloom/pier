// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DocsShell } from "@/lib/live-modules/pier-canvas-layout.ts";

describe("DocsShell", () => {
  it("renders sticky nav items and main content", () => {
    const onNavChange = vi.fn();
    render(
      <DocsShell
        header={<h1>Manual</h1>}
        nav={[
          { id: "start", label: "开始" },
          { id: "tasks", label: "常用任务" },
        ]}
        navId="start"
        onNavChange={onNavChange}
      >
        <p>Article body</p>
      </DocsShell>
    );

    expect(screen.getByRole("heading", { name: "Manual" })).toBeTruthy();
    expect(screen.getByText("Article body")).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Contents" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "开始" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  it("notifies onNavChange when a chapter is clicked", () => {
    const onNavChange = vi.fn();
    render(
      <DocsShell
        nav={[
          { id: "start", label: "开始" },
          { id: "tasks", label: "常用任务" },
        ]}
        navId="start"
        onNavChange={onNavChange}
      >
        <p>body</p>
      </DocsShell>
    );

    fireEvent.click(screen.getByRole("button", { name: "常用任务" }));
    expect(onNavChange).toHaveBeenCalledWith("tasks");
  });
});
