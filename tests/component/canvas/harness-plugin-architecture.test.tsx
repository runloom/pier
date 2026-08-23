import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Canvas from "../../../.pier/canvases/harness-plugin-architecture/harness-plugin-architecture.canvas.tsx";

afterEach(cleanup);

const CANVAS_DIR = join(
  process.cwd(),
  ".pier/canvases/harness-plugin-architecture"
);

function activateTab(name: string): void {
  // Radix TabsTrigger activates on mouseDown, not click.
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

describe("harness-plugin-architecture canvas", () => {
  it("pins methodology packs in instance.json", () => {
    const instance = JSON.parse(
      readFileSync(join(CANVAS_DIR, "instance.json"), "utf8")
    ) as Record<string, unknown>;
    expect(instance).toMatchObject({
      content: "design-doc",
      presentation: "decision_nav_4",
      role: "overview",
      status: "draft",
      ui: "pier-default",
    });
  });

  it("opens on the overview BLUF without scrolling", () => {
    render(<Canvas />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "AI Harness 插件机制架构对比"
    );
    expect(
      screen.getByText(/四个 harness 对「宿主内核稳定 vs 生态可扩展」/)
    ).toBeInTheDocument();
  });

  it("switches through problem, design, and landing tabs", () => {
    render(<Canvas />);

    activateTab("问题");
    expect(screen.getByText("插件机制的四重张力")).toBeInTheDocument();
    expect(screen.getByText("被放弃的对比框架")).toBeInTheDocument();

    activateTab("设计");
    expect(screen.getByText("四系统架构")).toBeInTheDocument();
    expect(screen.getByText("统一维度对比表")).toBeInTheDocument();
    expect(screen.getAllByRole("table").length).toBeGreaterThan(0);

    activateTab("落地");
    expect(screen.getByText("对 Pier 的启示")).toBeInTheDocument();
    expect(screen.getByText("证据基线")).toBeInTheDocument();
  });
});
