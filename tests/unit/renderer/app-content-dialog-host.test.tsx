import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AppContentDialogHost } from "@/components/common/app-content-dialog-host.tsx";
import {
  type AppContentDialogRenderProps,
  openAppContentDialog,
  resetAppContentDialogForTests,
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
});
