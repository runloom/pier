// @vitest-environment jsdom
import { DataChart } from "@pier/ui/data-chart.tsx";
import { NodeGraph } from "@pier/ui/node-graph.tsx";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { renderOfficialMermaid } from "@/lib/live-modules/official-mermaid-renderer.ts";

const NODES = [
  { id: "T0", title: "边界", tone: "done" as const },
  {
    id: "T1",
    title: "图表协议",
    tone: "success" as const,
  },
  {
    id: "T2",
    title: "产品面",
    tone: "warning" as const,
  },
];
const EDGES = [
  { source: "T0", target: "T1" },
  { source: "T1", target: "T2" },
];

describe("Pier Canvas visualizations", () => {
  it("renders different official Mermaid diagram families through one capability", async () => {
    const sources = [
      "flowchart LR\nA --> B",
      "sequenceDiagram\nA->>B: hello",
      [
        "gantt",
        "title Delivery",
        "dateFormat YYYY-MM-DD",
        "section Build",
        "Capability :done, a1, 2026-07-28, 1d",
      ].join("\n"),
    ];

    for (const source of sources) {
      const result = await renderOfficialMermaid(source, "dark");
      expect(result.ok, JSON.stringify(result)).toBe(true);
      if (result.ok) {
        expect(result.diagramType.length).toBeGreaterThan(0);
        expect(result.svg).toContain("<svg");
        expect(result.svg).not.toContain("<script");
      }
    }
  }, 15_000);

  it("selects nodes through the XYFlow-backed stable facade", async () => {
    const onSelect = vi.fn();
    render(
      <NodeGraph
        aria-label="实施路线"
        edges={EDGES}
        nodes={NODES}
        onSelectNode={onSelect}
        selectedId="T1"
      />
    );

    const productNode = await screen.findByLabelText("T2 产品面");
    fireEvent.click(productNode);
    expect(onSelect).toHaveBeenCalledWith("T2");

    await waitFor(() =>
      expect(
        document.querySelector('[data-slot="node-graph"] .react-flow')
      ).toBeTruthy()
    );
    expect(document.querySelector('[data-slot="node-graph"]')).toHaveClass(
      "h-80"
    );
  });

  it("renders a high-level data chart without exposing Recharts to callers", () => {
    const { container } = render(
      <DataChart
        aria-label="能力完成趋势"
        categoryKey="name"
        data={[
          { name: "协议", value: 1 },
          { name: "DAG", value: 2 },
        ]}
        series={[{ key: "value", label: "完成数" }]}
        type="bar"
      />
    );

    expect(container.querySelector('[data-slot="data-chart"]')).toBeTruthy();
    expect(screen.getByRole("img", { name: "能力完成趋势" })).toBeTruthy();
  });

  it("shows an explicit empty state", () => {
    render(
      <DataChart
        aria-label="空图表"
        categoryKey="name"
        data={[]}
        series={[{ key: "value", label: "完成数" }]}
        type="line"
      />
    );
    expect(screen.getByText("暂无可绘制的数据。")).toBeTruthy();
  });
});
