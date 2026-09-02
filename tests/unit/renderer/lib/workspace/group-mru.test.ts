import { describe, expect, it } from "vitest";
import {
  attachWorkspaceGroupMru,
  forgetGroup,
  groupMruIds,
  resetGroupMru,
  touchGroup,
} from "@/lib/workspace/group-mru.ts";

describe("groupMru", () => {
  it("moves an existing id to the front on touch", () => {
    resetGroupMru();
    touchGroup("a");
    touchGroup("b");
    touchGroup("a");
    expect(groupMruIds()).toEqual(["a", "b"]);
  });

  it("forgets a removed group", () => {
    resetGroupMru();
    touchGroup("a");
    touchGroup("b");
    forgetGroup("a");
    expect(groupMruIds()).toEqual(["b"]);
  });

  it("reset clears the queue", () => {
    resetGroupMru();
    touchGroup("a");
    resetGroupMru();
    expect(groupMruIds()).toEqual([]);
  });

  it("attach seeds the active group and records later changes", () => {
    resetGroupMru();
    let onActive: ((group: { id?: string } | undefined) => void) | undefined;
    let onRemove: ((group: { id?: string }) => void) | undefined;
    const api = {
      activeGroup: { id: "g1" },
      onDidActiveGroupChange: (
        listener: (group: { id?: string } | undefined) => void
      ) => {
        onActive = listener;
        return { dispose: () => undefined };
      },
      onDidRemoveGroup: (listener: (group: { id?: string }) => void) => {
        onRemove = listener;
        return { dispose: () => undefined };
      },
    };

    const dispose = attachWorkspaceGroupMru(api);
    expect(groupMruIds()).toEqual(["g1"]);

    onActive?.({ id: "g2" });
    expect(groupMruIds()).toEqual(["g2", "g1"]);

    onRemove?.({ id: "g1" });
    expect(groupMruIds()).toEqual(["g2"]);

    dispose();
    expect(groupMruIds()).toEqual([]);
  });
});
