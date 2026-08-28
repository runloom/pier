import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  APPROVAL_KEYS,
  ApprovalBar,
} from "../../../apps/mobile-web/src/components/approval-bar.tsx";

describe("ApprovalBar（M1 审批条）", () => {
  afterEach(() => {
    cleanup();
  });

  it("非 waiting 或无 pendingInteractionId 时不渲染", () => {
    const { container } = render(
      <ApprovalBar interactionId={null} onRespond={() => {}} waiting={false} />
    );
    expect(container).toBeEmptyDOMElement();

    render(
      <ApprovalBar
        interactionId="hook-1"
        onRespond={() => {}}
        waiting={false}
      />
    );
    expect(container).toBeEmptyDOMElement();

    render(<ApprovalBar interactionId={null} onRespond={() => {}} waiting />);
    expect(container).toBeEmptyDOMElement();
  });

  it("waiting 且带 pendingInteractionId 时渲染 13 键", () => {
    render(
      <ApprovalBar interactionId="hook-42" onRespond={() => {}} waiting />
    );
    expect(screen.getByTestId("approval-bar")).toBeDefined();
    const expected = [
      "enter",
      "escape",
      "y",
      "n",
      "1",
      "2",
      "3",
      "4",
      "5",
      "6",
      "7",
      "8",
      "9",
    ];
    expect([...APPROVAL_KEYS]).toEqual(expected);
    for (const key of expected) {
      expect(screen.getByTestId(`approval-key-${key}`)).toBeDefined();
    }
    expect(screen.getByText(/hook-42/)).toBeDefined();
  });

  it("点击按键回调对应键名", () => {
    const onRespond = vi.fn();
    render(
      <ApprovalBar interactionId="hook-1" onRespond={onRespond} waiting />
    );
    fireEvent.click(screen.getByTestId("approval-key-y"));
    fireEvent.click(screen.getByTestId("approval-key-escape"));
    fireEvent.click(screen.getByTestId("approval-key-7"));
    expect(onRespond).toHaveBeenCalledTimes(3);
    expect(onRespond).toHaveBeenNthCalledWith(1, "y");
    expect(onRespond).toHaveBeenNthCalledWith(2, "escape");
    expect(onRespond).toHaveBeenNthCalledWith(3, "7");
  });

  it("stale 时显示失效提示且不出现语义按钮", () => {
    render(
      <ApprovalBar interactionId="hook-1" onRespond={() => {}} stale waiting />
    );
    expect(screen.getByTestId("approval-stale").textContent).toContain(
      "交互已失效"
    );
    // schema 不含语义动作字段，UI 不出现「批准/拒绝」语义按钮
    expect(screen.queryByText("批准")).toBeNull();
    expect(screen.queryByText("拒绝")).toBeNull();
  });
});
