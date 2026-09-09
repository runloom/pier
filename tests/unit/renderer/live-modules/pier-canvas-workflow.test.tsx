// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { WorldStage } from "@/lib/live-modules/pier-canvas-artboard.tsx";
import { WorkflowDiagram } from "@/lib/live-modules/pier-canvas-workflow.tsx";
import {
  agentToolCallWorkflowSpec,
  reviewWorkflowSpec,
} from "../../ui/canvas-workflow/fixtures.ts";

describe("WorkflowDiagram", () => {
  it("mounts the review gold sample on a world stage", () => {
    render(<WorkflowDiagram spec={reviewWorkflowSpec} />);
    expect(document.querySelector("[data-canvas-stage='world']")).toBeTruthy();
    expect(
      document.querySelector("[data-slot='workflow-diagram']")
    ).toBeTruthy();
    expect(screen.getByText("Review")).toBeTruthy();
    expect(screen.getByText(/Happy path/)).toBeTruthy();
    expect(screen.getByText(/Recover/)).toBeTruthy();
    const exception = document.querySelector(
      "[data-slot='workflow-lane'][data-variant='exception']"
    );
    expect(exception).toBeTruthy();
    expect(document.querySelector("[data-slot='workflow-title']")).toBeTruthy();
    expect(
      document.querySelectorAll("[data-slot='workflow-edge']").length
    ).toBe(5);
    expect(document.querySelector("[data-role='error']")).toBeTruthy();
    expect(document.querySelector("[data-role='return']")).toBeTruthy();
    const open = document.querySelector(
      "[data-slot='workflow-edge'][data-edge-id='e-open']"
    );
    const reject = document.querySelector(
      "[data-slot='workflow-edge'][data-edge-id='e-reject']"
    );
    expect(open).toHaveAttribute("data-main-path", "true");
    expect(
      open?.querySelector("[data-slot='workflow-edge-casing']")
    ).toBeNull();
    expect(
      document.querySelector(
        "[data-slot='workflow-edge-arrow'][data-edge-id='e-open']"
      )
    ).toBeTruthy();
    expect(
      open?.querySelector("[data-slot='workflow-edge-stroke']")
    ).toHaveAttribute("stroke-width", "1.5");
    expect(
      document.querySelector("[data-slot='workflow-diagram'] svg")
    ).toBeTruthy();
    expect(reject).not.toHaveAttribute("data-main-path");
    expect(
      reject?.querySelector("[data-slot='workflow-edge-stroke']")
    ).toHaveAttribute("stroke-dasharray", "5 4");
  });

  it("paints Empty and no edges when the spec cannot compile", () => {
    render(
      <WorkflowDiagram
        spec={{
          ...reviewWorkflowSpec,
          edges: [],
        }}
      />
    );
    expect(document.querySelector("[data-workflow='invalid']")).toBeTruthy();
    expect(document.querySelector("[data-slot='workflow-edge']")).toBeNull();
    expect(screen.getByText(/no edge from "submit" to "review"/i)).toBeTruthy();
    expect(screen.getByText(/Add an edge/i)).toBeTruthy();
  });

  it("highlights the related group on node hover and restores on leave", () => {
    render(<WorkflowDiagram spec={reviewWorkflowSpec} />);
    fireEvent.pointerEnter(screen.getByText("Submit"));
    expect(document.querySelector("[data-node-id='submit']")).toHaveAttribute(
      "data-workflow-state",
      "hot"
    );
    expect(document.querySelector("[data-node-id='review']")).toHaveAttribute(
      "data-workflow-state",
      "hot"
    );
    expect(document.querySelector("[data-edge-id='e-open']")).toHaveAttribute(
      "data-workflow-state",
      "hot"
    );
    expect(document.querySelector("[data-node-id='pass']")).toHaveAttribute(
      "data-workflow-state",
      "dim"
    );
    expect(
      document.querySelector("[data-slot='workflow-edge-flow']")
    ).toBeTruthy();
    const submit = document.querySelector("[data-node-id='submit']");
    const pass = document.querySelector("[data-node-id='pass']");
    expect(String(submit?.getAttribute("class") ?? "")).not.toMatch(
      /animate|pulse|ring-primary/
    );
    expect(submit).toHaveAttribute("data-workflow-state", "hot");
    expect(pass).toHaveAttribute("data-workflow-state", "dim");
    fireEvent.pointerLeave(
      document.querySelector("[data-slot='workflow-diagram']") as HTMLElement
    );
    expect(document.querySelector("[data-node-id='pass']")).toHaveAttribute(
      "data-workflow-state",
      "idle"
    );
  });

  it("paints edge darts and flows only the hot edge", () => {
    const { container } = render(<WorkflowDiagram spec={reviewWorkflowSpec} />);
    expect(container.querySelectorAll("marker")).toHaveLength(0);
    expect(
      container.querySelectorAll("[data-slot='workflow-edge-arrow']").length
    ).toBe(5);
    expect(
      container.querySelector("[data-slot='workflow-edge-flow']")
    ).toBeNull();
    fireEvent.pointerEnter(screen.getByText("Open review"));
    const flow = container.querySelector("[data-slot='workflow-edge-flow']");
    expect(flow?.closest("[data-edge-id='e-open']")).toBeTruthy();
    expect(
      container.querySelectorAll("[data-slot='workflow-edge-flow']")
    ).toHaveLength(1);
    const label = container.querySelector(
      "[data-slot='workflow-edge-label'][data-edge-id='e-open']"
    );
    expect(label).toHaveAttribute("data-workflow-state", "hot");
    expect(String(label?.getAttribute("class") ?? "")).not.toMatch(
      /animate|pulse|ring-/
    );
  });

  it("paints the agent-tool-call gold: groups, legend, and notes", () => {
    render(<WorkflowDiagram spec={agentToolCallWorkflowSpec} />);
    expect(
      document.querySelectorAll("[data-slot='workflow-lane']")
    ).toHaveLength(4);
    expect(
      document.querySelectorAll("[data-slot='workflow-group']")
    ).toHaveLength(4);
    expect(screen.getByText("Planning loop")).toBeTruthy();
    expect(screen.getByText("Approval Gate")).toBeTruthy();
    expect(
      document.querySelector(
        "[data-edge-id='e-consent'] [data-slot='workflow-edge-stroke']"
      )
    ).toHaveAttribute("stroke-width", "1.5");
    expect(
      document.querySelector(
        "[data-edge-id='e-consent'] [data-slot='workflow-edge-stroke']"
      )
    ).toHaveAttribute("stroke-dasharray", "5 4");
    expect(
      document.querySelector(
        "[data-edge-id='e-allow'] [data-slot='workflow-edge-stroke']"
      )
    ).toHaveAttribute("stroke-width", "1.5");
    expect(
      document.querySelector("[data-slot='workflow-legend']")
    ).toBeTruthy();
    expect(screen.getByText("Store")).toBeTruthy();
    expect(screen.getByText("Compiler contract")).toBeTruthy();
    expect(document.querySelector("[data-node-id='approval']")).toHaveAttribute(
      "data-kind",
      "gate"
    );
    expect(document.querySelector("[data-workflow='invalid']")).toBeNull();
    expect(document.querySelector("[data-node-id='approval']")).toHaveAttribute(
      "data-workflow-state",
      "idle"
    );
  });

  it("does not nest a second world stage when already on one", () => {
    render(
      <WorldStage>
        <WorkflowDiagram spec={reviewWorkflowSpec} />
        <WorkflowDiagram spec={reviewWorkflowSpec} />
      </WorldStage>
    );
    expect(
      document.querySelectorAll("[data-canvas-stage='world']")
    ).toHaveLength(1);
    expect(
      document.querySelectorAll("[data-slot='workflow-diagram']")
    ).toHaveLength(2);
  });
});
