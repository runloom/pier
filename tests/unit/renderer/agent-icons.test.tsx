import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentIcon } from "@/components/agent-icons/index.tsx";

describe("AgentIcon 四级 dispatch", () => {
  it("内联 iconId 渲染 svg（claude + 新内联 gemini/omp/kilo）", () => {
    for (const id of ["claude", "gemini", "omp", "kilo"] as const) {
      const { container, unmount } = render(<AgentIcon agentId={id} />);
      expect(container.querySelector("svg"), id).not.toBeNull();
      expect(container.querySelector("img"), id).toBeNull();
      unmount();
    }
  });

  it("iconUrl 渲染 img（openclaude 哨兵 → PNG，非字面值）", () => {
    const { container } = render(<AgentIcon agentId="openclaude" />);
    const img = container.querySelector("img");
    expect(img).not.toBeNull();
    expect(img?.getAttribute("src")).not.toBe("openclaude");
  });

  it("faviconDomain 渲染 img（grok）", () => {
    const { container } = render(<AgentIcon agentId="grok" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "x.ai"
    );
  });

  it("空 agentId 渲染首字母兜底 ?", () => {
    const { container } = render(<AgentIcon agentId={null} />);
    expect(container.querySelector("svg text")?.textContent).toBe("?");
  });
});
