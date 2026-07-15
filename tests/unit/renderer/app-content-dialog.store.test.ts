import { beforeEach, describe, expect, it } from "vitest";
import {
  closeAppContentDialog,
  openAppContentDialog,
  resetAppContentDialogForTests,
  updateAppContentDialog,
  useAppContentDialogStore,
} from "@/stores/app-content-dialog.store.ts";

function Dummy() {
  return null;
}

describe("app content dialog store", () => {
  beforeEach(() => {
    resetAppContentDialogForTests();
  });

  it("pushes a layer and resolves null on dismiss close", async () => {
    const handle = openAppContentDialog({
      id: "test.a",
      title: "A",
      content: Dummy,
    });
    expect(useAppContentDialogStore.getState().stack).toHaveLength(1);
    expect(useAppContentDialogStore.getState().stack[0]?.id).toBe("test.a");

    closeAppContentDialog("test.a");
    await expect(handle.result).resolves.toBeNull();
    expect(useAppContentDialogStore.getState().stack).toHaveLength(0);
  });

  it("namespaces and replaces same id", () => {
    openAppContentDialog({
      id: "accounts.add",
      title: "One",
      content: Dummy,
      namespace: "pier.grok",
    });
    openAppContentDialog({
      id: "accounts.add",
      title: "Two",
      content: Dummy,
      namespace: "pier.grok",
    });
    const stack = useAppContentDialogStore.getState().stack;
    expect(stack).toHaveLength(1);
    expect(stack[0]?.id).toBe("pier.grok:accounts.add");
    expect(stack[0]?.title).toBe("Two");
  });

  it("supports stacked layers and close by id", async () => {
    const a = openAppContentDialog({ id: "a", title: "A", content: Dummy });
    const b = openAppContentDialog({ id: "b", title: "B", content: Dummy });
    expect(useAppContentDialogStore.getState().stack.map((l) => l.id)).toEqual([
      "a",
      "b",
    ]);
    closeAppContentDialog("b", { ok: true });
    await expect(b.result).resolves.toEqual({ ok: true });
    expect(useAppContentDialogStore.getState().stack.map((l) => l.id)).toEqual([
      "a",
    ]);
    closeAppContentDialog("a");
    await expect(a.result).resolves.toBeNull();
  });

  it("update patches dismissible/title", () => {
    openAppContentDialog({
      id: "w",
      title: "Wait",
      content: Dummy,
      dismissible: true,
    });
    updateAppContentDialog("w", { dismissible: false, title: "Waiting" });
    const layer = useAppContentDialogStore.getState().stack[0];
    expect(layer?.dismissible).toBe(false);
    expect(layer?.title).toBe("Waiting");
  });
});
