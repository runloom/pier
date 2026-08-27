import { parsePierCanvasMeta } from "@shared/contracts/pier-canvas.ts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import Canvas, {
  canvas,
} from "../../../.pier/canvases/mobile-companion/mobile-companion.canvas.tsx";

afterEach(cleanup);

function activateTab(name: string): void {
  // Radix TabsTrigger activates on mouseDown, not click.
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

describe("mobile-companion canvas", () => {
  it("exports a composition overview", () => {
    expect(parsePierCanvasMeta(canvas)).toEqual({
      description: "Pier 移动端：状态投影与受控闭环。线框锁定信息架构。",
      kind: "composition",
      title: "Pier 移动端",
    });
  });

  it("opens on the host-first BLUF without a Day-1 tab", () => {
    render(<Canvas />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
      "Pier 移动端"
    );
    expect(
      screen.getByText(/核心体验必须整条齐才对外交付/)
    ).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "速览" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "设计" })).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "首日" })).not.toBeInTheDocument();
  });

  it("shows host-first Artboard wireframes on the design tab", () => {
    render(<Canvas />);
    activateTab("设计");
    expect(screen.getByText("交互顺序")).toBeInTheDocument();
    expect(screen.getByText("信息架构线框")).toBeInTheDocument();
    expect(document.querySelector("[data-slot='artboard-stage']")).toBeTruthy();
    expect(document.querySelectorAll("[data-slot='artboard']")).toHaveLength(8);
    expect(screen.getByLabelText("未配对")).toBeInTheDocument();
    expect(screen.getByLabelText("主机列表")).toBeInTheDocument();
    expect(screen.getByLabelText("主机工作台")).toBeInTheDocument();
    expect(screen.getByLabelText("文件浏览")).toBeInTheDocument();
    expect(screen.queryByLabelText("活动总览")).not.toBeInTheDocument();
    expect(screen.getAllByText("当前屏幕").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "全屏查看线框" })
    ).toBeInTheDocument();
  });

  it("shows the six-step loop only on the problem tab", () => {
    render(<Canvas />);
    expect(screen.queryByText("就地闭环")).not.toBeInTheDocument();
    expect(screen.queryByText("离开能叫醒")).not.toBeInTheDocument();
    activateTab("问题");
    expect(screen.getByText("闭环")).toBeInTheDocument();
    expect(screen.getByText("配对一次")).toBeInTheDocument();
    expect(screen.getByText("打开见主机")).toBeInTheDocument();
    expect(screen.getByText("投影会话")).toBeInTheDocument();
    expect(screen.getByText("就地闭环")).toBeInTheDocument();
    expect(screen.getByText("远程仍在")).toBeInTheDocument();
    expect(screen.getByText(/跨网宿主出站保持在线/)).toBeInTheDocument();
    expect(screen.getByText("离开能叫醒")).toBeInTheDocument();
    expect(screen.queryByText(/家里电脑/)).not.toBeInTheDocument();
  });

  it("keeps T1 honest and D2 keys gated on the design tab", () => {
    render(<Canvas />);
    activateTab("设计");
    expect(screen.getAllByText("当前屏幕").length).toBeGreaterThan(0);
    expect(
      screen.getByText("未授权则隐藏。Tab / ^C / 方向键不是审批键")
    ).toBeInTheDocument();
    expect(screen.getAllByText(/不开放公网入站/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/已连会话立即断开/).length).toBeGreaterThan(0);
    expect(screen.getByText(/路径：本网监听直连/)).toBeInTheDocument();
    expect(screen.getByText("远程访问开后不监听任何端口")).toBeInTheDocument();
    expect(
      screen.getByText("吊销只作废令牌、不断开已连会话")
    ).toBeInTheDocument();
    expect(
      screen.getByText("把 Web 令牌写入局域网 origin")
    ).toBeInTheDocument();
    expect(screen.queryByText("完整历史")).not.toBeInTheDocument();
    expect(screen.queryByText(/scrollback/i)).not.toBeInTheDocument();
  });

  it("does not replay the six-step loop on landing", () => {
    render(<Canvas />);
    activateTab("落地");
    expect(screen.getByText(/第一条可交付产品线/)).toBeInTheDocument();
    expect(screen.queryByText("就地闭环")).not.toBeInTheDocument();
    expect(screen.queryByText("离开能叫醒")).not.toBeInTheDocument();
  });

  it("treats rendezvous plus wake as the first shippable core", () => {
    render(<Canvas />);
    activateTab("落地");
    expect(screen.getByText(/第一条可交付产品线/)).toBeInTheDocument();
    expect(screen.getAllByText("核心交付").length).toBeGreaterThan(0);
    expect(screen.getByText("内部切片")).toBeInTheDocument();
    expect(screen.getByText(/官方会合 HTTPS origin/)).toBeInTheDocument();
  });
});
