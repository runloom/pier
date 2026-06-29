import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentIcon } from "@/components/agent-icons/index.tsx";

describe("AgentIcon", () => {
  it("内联图标 agent 渲染 svg（claude）", () => {
    const { container } = render(<AgentIcon agentId="claude" />);
    expect(container.querySelector("svg")).not.toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("favicon agent 渲染 img（gemini）", () => {
    const { container } = render(<AgentIcon agentId="gemini" />);
    expect(container.querySelector("img")?.getAttribute("src")).toContain(
      "gemini.google.com"
    );
  });

  it("空 agentId 渲染首字母兜底 ?", () => {
    const { container } = render(<AgentIcon agentId={null} />);
    expect(container.querySelector("svg text")?.textContent).toBe("?");
  });
});
