import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import {
  type AppContentDialogRenderProps,
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  useAppContentDialogStore,
} from "@/stores/app-content-dialog.store.ts";

function Body(props: AppContentDialogRenderProps<{ v: number }>) {
  return (
    <button onClick={() => props.close({ v: 1 })} type="button">
      Finish
    </button>
  );
}

describe("AppContentDialogHost", () => {
  afterEach(() => {
    cleanup();
    resetAppContentDialogForTests();
    document.body.style.pointerEvents = "";
    vi.useRealTimers();
  });

  it("renders top content and resolves on content close", async () => {
    render(<AppContentDialogHost />);
    let resultPromise!: Promise<{ v: number } | null>;
    await act(async () => {
      const handle = openAppContentDialog<{ v: number }>({
        content: Body,
        id: "demo",
        title: "Demo title",
      });
      resultPromise = handle.result;
    });
    expect(screen.getByText("Demo title")).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    });
    await expect(resultPromise).resolves.toEqual({ v: 1 });
  });

  it("retains the shell after close so exit animation can play", async () => {
    render(<AppContentDialogHost />);
    await act(async () => {
      openAppContentDialog({
        content: Body,
        id: "demo-exit",
        title: "Exit title",
      });
    });
    expect(screen.getByText("Exit title")).toBeTruthy();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Finish" }));
    });

    // Store is cleared immediately, but the host keeps the shell mounted with
    // open=false so Dialog can play data-closed exit animation.
    // jsdom Presence unmounts portal children without CSS animations, so assert
    // the retained shell marker rather than dialog text content.
    expect(useAppContentDialogStore.getState().stack).toHaveLength(0);
    const shell = screen.getByTestId("content-dialog-layer-demo-exit");
    expect(shell.getAttribute("data-open")).toBe("false");
  });

  it("retains a closed top layer while a lower content dialog remains open", async () => {
    vi.useFakeTimers();
    render(<AppContentDialogHost />);
    await act(async () => {
      openAppContentDialog({
        content: Body,
        id: "lower",
        title: "Lower",
      });
      openAppContentDialog({
        content: Body,
        id: "upper",
        title: "Upper",
      });
    });
    expect(screen.getByTestId("content-dialog-layer-upper")).toBeTruthy();

    await act(async () => {
      closeAppContentDialog("upper", { v: 9 });
    });

    expect(useAppContentDialogStore.getState().stack.map((l) => l.id)).toEqual([
      "lower",
    ]);
    expect(
      screen.getByTestId("content-dialog-layer-upper").getAttribute("data-open")
    ).toBe("false");
    expect(
      screen.getByTestId("content-dialog-layer-lower").getAttribute("data-open")
    ).toBe("true");

    await act(async () => {
      vi.advanceTimersByTime(150);
    });
    expect(screen.queryByTestId("content-dialog-layer-upper")).toBeNull();
    expect(
      screen.getByTestId("content-dialog-layer-lower").getAttribute("data-open")
    ).toBe("true");
  });

  it("blocks ESC when not dismissible", async () => {
    render(<AppContentDialogHost />);
    await act(async () => {
      openAppContentDialog({
        content: Body,
        dismissible: false,
        id: "locked",
        title: "Locked",
      });
    });
    await act(async () => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.getByText("Locked")).toBeTruthy();
  });

  it("defers first mount while body is locked, then shows after unlock", async () => {
    vi.useFakeTimers();
    document.body.style.pointerEvents = "none";
    render(<AppContentDialogHost />);

    await act(async () => {
      openAppContentDialog({
        content: Body,
        id: "from-menu",
        title: "From menu",
      });
    });
    // Layer is staged, but Dialog must not force-open under body lock.
    expect(screen.queryByText("From menu")).toBeNull();
    expect(useAppContentDialogStore.getState().stack).toHaveLength(1);

    document.body.style.pointerEvents = "";
    await act(async () => {
      vi.runAllTimers();
    });
    expect(screen.getByText("From menu")).toBeTruthy();
  });
});
