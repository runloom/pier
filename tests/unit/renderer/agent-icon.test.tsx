import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentIcon } from "@/components/agent-icons/index.tsx";

describe("AgentIcon 四级 dispatch", () => {
  it("内联 iconId 渲染 svg（gemini/omp/kilo 新内联）", () => {
    for (const id of ["gemini", "omp", "kilo", "claude"] as const) {
      const { container, unmount } = render(<AgentIcon agentId={id} />);
      expect(container.querySelector("svg"), id).toBeTruthy();
      unmount();
    }
  });

  it("iconUrl 渲染 img（openclaude 哨兵 → PNG）", () => {
    const { container } = render(<AgentIcon agentId="openclaude" />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    // 哨兵被映射成真实 PNG url（非字面 "openclaude"）
    expect(img?.getAttribute("src")).not.toBe("openclaude");
  });

  it("faviconDomain 渲染 img（grok）", () => {
    const { container } = render(<AgentIcon agentId="grok" />);
    const img = container.querySelector("img");
    expect(img).toBeTruthy();
    expect(img?.getAttribute("src")).toContain("x.ai");
  });

  it("null agentId → letter fallback（? svg）", () => {
    const { container } = render(<AgentIcon agentId={null} />);
    expect(container.querySelector("svg")).toBeTruthy();
    expect(container.textContent).toContain("?");
  });
});
