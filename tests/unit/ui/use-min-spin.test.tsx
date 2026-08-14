import { useMinSpinVisual } from "@pier/ui/hooks/use-min-spin.ts";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

function Probe({ busy }: { busy: boolean }) {
  const spinning = useMinSpinVisual(busy);
  return <div data-testid="spin">{String(spinning)}</div>;
}

describe("useMinSpinVisual", () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("starts spinning immediately when busy turns true", () => {
    const { getByTestId, rerender } = render(<Probe busy={false} />);
    expect(getByTestId("spin").textContent).toBe("false");

    rerender(<Probe busy={true} />);
    expect(getByTestId("spin").textContent).toBe("true");
  });

  it("holds the spin for at least minMs after busy turns false", () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(<Probe busy={true} />);

    rerender(<Probe busy={false} />);
    expect(getByTestId("spin").textContent).toBe("true");

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(getByTestId("spin").textContent).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId("spin").textContent).toBe("false");
  });

  it("releases the spin immediately when busy already lasted past minMs", () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(<Probe busy={true} />);

    act(() => {
      vi.advanceTimersByTime(500);
    });
    rerender(<Probe busy={false} />);
    expect(getByTestId("spin").textContent).toBe("false");
  });

  it("re-arms the floor when busy turns true again during the hold", () => {
    vi.useFakeTimers();
    const { getByTestId, rerender } = render(<Probe busy={true} />);

    rerender(<Probe busy={false} />);
    act(() => {
      vi.advanceTimersByTime(200);
    });
    rerender(<Probe busy={true} />);
    rerender(<Probe busy={false} />);

    act(() => {
      vi.advanceTimersByTime(299);
    });
    expect(getByTestId("spin").textContent).toBe("true");

    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(getByTestId("spin").textContent).toBe("false");
  });
});
