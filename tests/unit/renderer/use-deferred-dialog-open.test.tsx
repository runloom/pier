import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useDeferredDialogOpen } from "../../../packages/ui/src/use-deferred-dialog-open.ts";

function Probe({
  open,
  onAbandon,
}: {
  open: boolean | undefined;
  onAbandon?: () => void;
}) {
  const deferred = useDeferredDialogOpen(open, { onAbandon });
  return <div data-testid="open">{String(deferred)}</div>;
}

describe("useDeferredDialogOpen", () => {
  afterEach(() => {
    cleanup();
    document.body.replaceChildren();
    document.body.style.pointerEvents = "";
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("keeps uncontrolled open as undefined", () => {
    const { getByTestId } = render(<Probe open={undefined} />);
    expect(getByTestId("open").textContent).toBe("undefined");
  });

  it("opens synchronously when no overlay is active", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    const { getByTestId, rerender } = render(<Probe open={false} />);
    expect(getByTestId("open").textContent).toBe("false");

    rerender(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("true");
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("opens synchronously on first mount when already open", () => {
    const { getByTestId } = render(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("true");
  });

  it("waits until the menu overlay is gone before opening", () => {
    vi.useFakeTimers();
    const menu = document.createElement("div");
    menu.setAttribute("data-slot", "dropdown-menu-content");
    document.body.append(menu);

    const { getByTestId, rerender } = render(<Probe open={false} />);
    rerender(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("false");

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(getByTestId("open").textContent).toBe("false");

    menu.remove();
    act(() => {
      vi.runAllTimers();
    });
    expect(getByTestId("open").textContent).toBe("true");
  });

  it("waits until body pointer-events unlock before opening", () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";

    const { getByTestId, rerender } = render(<Probe open={false} />);
    rerender(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("false");

    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(getByTestId("open").textContent).toBe("false");

    document.body.style.pointerEvents = "";
    act(() => {
      vi.runAllTimers();
    });
    expect(getByTestId("open").textContent).toBe("true");
  });

  it("opens nested dialogs immediately while a parent modal locks body", () => {
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");
    document.body.style.pointerEvents = "none";
    const parent = document.createElement("div");
    parent.setAttribute("data-slot", "dialog-content");
    document.body.append(parent);

    const { getByTestId, rerender } = render(<Probe open={false} />);
    rerender(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("true");
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it("still defers when a menu is open inside a parent modal", () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";
    const parent = document.createElement("div");
    parent.setAttribute("data-slot", "dialog-content");
    document.body.append(parent);
    const menu = document.createElement("div");
    menu.setAttribute("data-slot", "dropdown-menu-content");
    document.body.append(menu);

    const { getByTestId, rerender } = render(<Probe open={false} />);
    rerender(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("false");

    menu.remove();
    act(() => {
      vi.runAllTimers();
    });
    expect(getByTestId("open").textContent).toBe("true");
  });

  it("abandons deferred open and notifies when still blocked after timeout", () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";
    const onAbandon = vi.fn();

    const { getByTestId, rerender } = render(
      <Probe onAbandon={onAbandon} open={false} />
    );
    rerender(<Probe onAbandon={onAbandon} open={true} />);
    expect(getByTestId("open").textContent).toBe("false");

    act(() => {
      vi.advanceTimersByTime(1200);
    });

    expect(getByTestId("open").textContent).toBe("false");
    expect(onAbandon).toHaveBeenCalledOnce();
  });

  it("cancels a pending deferred open when open becomes false", () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";
    const onAbandon = vi.fn();

    const { getByTestId, rerender } = render(
      <Probe onAbandon={onAbandon} open={false} />
    );
    rerender(<Probe onAbandon={onAbandon} open={true} />);
    expect(getByTestId("open").textContent).toBe("false");

    rerender(<Probe onAbandon={onAbandon} open={false} />);
    document.body.style.pointerEvents = "";
    act(() => {
      vi.runAllTimers();
    });

    expect(getByTestId("open").textContent).toBe("false");
    expect(onAbandon).not.toHaveBeenCalled();
  });

  it("closes controlled dialogs immediately", () => {
    const { getByTestId, rerender } = render(<Probe open={true} />);
    expect(getByTestId("open").textContent).toBe("true");

    rerender(<Probe open={false} />);
    expect(getByTestId("open").textContent).toBe("false");
  });
});
