import { PierFileTree, type PierFileTreeApi } from "@pier/ui/file/tree.tsx";
import { usePierFileTreeScrollController } from "@pier/ui/file/tree-scroll-controller.ts";
import * as scrollOwners from "@pier/ui/file/tree-scroll-owner.ts";
import {
  act,
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

type Controller = ReturnType<typeof usePierFileTreeScrollController>;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function mountRealTree() {
  const owner = scrollOwners.createFileTreeScrollOwner();
  vi.spyOn(scrollOwners, "createFileTreeScrollOwner").mockReturnValue(owner);
  const api = { current: null as PierFileTreeApi | null };
  const { container } = render(
    <PierFileTree
      items={Array.from({ length: 100 }, (_, index) => ({
        kind: "file" as const,
        path: `file-${String(index).padStart(2, "0")}.ts`,
      }))}
      label="Project files"
      treeApiRef={api}
    />
  );
  await act(async () => {
    await Promise.resolve();
  });
  const scroller = container
    .querySelector("file-tree-container")
    ?.shadowRoot?.querySelector<HTMLElement>(
      "[data-file-tree-virtualized-scroll]"
    );
  if (!(scroller && api.current)) {
    throw new Error("Expected the real file tree to mount");
  }
  return { api: api.current, owner, scroller };
}

function mountController() {
  let controller: Controller | null = null;
  const scroller = document.createElement("div");
  scroller.setAttribute("data-file-tree-virtualized-scroll", "true");
  const host = document.createElement("file-tree-container");
  host.setAttribute("data-slot", "pier-file-tree");
  host.attachShadow({ mode: "open" }).append(scroller);

  function Harness() {
    const containerRef = useRef<HTMLDivElement>(null);
    controller = usePierFileTreeScrollController({
      containerRef,
      onScrollSnapshotChange: undefined,
      scrollControllerRef: undefined,
    });
    return (
      <div
        ref={(node) => {
          containerRef.current = node;
          node?.append(host);
        }}
      />
    );
  }

  render(<Harness />);
  if (!controller) {
    throw new Error("Expected the scroll controller to mount");
  }
  return { controller: controller as Controller, scroller };
}

async function deliverScroll(scroller: HTMLElement) {
  await act(async () => {
    // Browsers deliver scroll after the write call stack, not inside its setter.
    await Promise.resolve();
    fireEvent.scroll(scroller);
  });
}

describe("file-tree native scroll attribution", () => {
  it("keeps ownership through the real tree's deferred offscreen reveal", async () => {
    const { api, owner, scroller } = await mountRealTree();
    const onClaim = vi.fn();
    owner.subscribeUserClaim(onClaim);

    await act(async () => {
      expect(
        api.revealPath("file-90.ts", {
          intent: "explicit",
          preserveFocus: true,
        })
      ).toBe(true);
      // The model queues a request; Preact writes scrollTop after this stack.
      expect(scroller.scrollTop).toBe(0);
      expect(owner.isRevealActive()).toBe(true);
      await Promise.resolve();
    });
    expect(scroller.scrollTop).toBeGreaterThan(1000);
    await deliverScroll(scroller);

    expect(onClaim).not.toHaveBeenCalled();
    expect(owner.isRevealActive()).toBe(true);
    expect(owner.isUserScrolling()).toBe(false);
    await waitFor(() => expect(owner.isRevealActive()).toBe(false));
  });

  it.each([
    "wheel",
    "touchmove",
    "keydown",
    "scrollbar",
  ])("cancels the real tree's deferred write when %s input takes over", async (gesture) => {
    const { api, owner, scroller } = await mountRealTree();

    await act(async () => {
      api.revealPath("file-90.ts", {
        intent: "explicit",
        preserveFocus: true,
      });
      if (gesture === "scrollbar") {
        scroller.scrollTop = 100;
        fireEvent.scroll(scroller);
      } else if (gesture === "keydown") {
        fireEvent.keyDown(scroller, { key: "PageDown" });
      } else if (gesture === "touchmove") {
        fireEvent.touchMove(scroller);
      } else {
        fireEvent.wheel(scroller, { deltaY: 100 });
      }
      await Promise.resolve();
    });

    expect(scroller.scrollTop).toBe(gesture === "scrollbar" ? 100 : 0);
    expect(owner.isRevealActive()).toBe(false);
    expect(owner.isUserScrolling()).toBe(true);
  });

  it("lets a later select-only request cancel an unprocessed scroll", async () => {
    const { api, scroller } = await mountRealTree();
    await act(async () => {
      api.revealPath("file-90.ts", { intent: "explicit", preserveFocus: true });
      api.revealPath("file-10.ts", {
        intent: "explicit",
        preserveFocus: true,
        scroll: "none",
      });
      await Promise.resolve();
    });
    expect(scroller.scrollTop).toBe(0);
  });

  it("lets a native scrollbar take over after the real reveal scroll event", async () => {
    const { api, owner, scroller } = await mountRealTree();
    await act(async () => {
      api.revealPath("file-90.ts", { intent: "explicit", preserveFocus: true });
      await Promise.resolve();
    });
    await deliverScroll(scroller);
    expect(owner.isRevealActive()).toBe(true);

    scroller.scrollTop -= 100;
    await deliverScroll(scroller);
    expect(owner.isRevealActive()).toBe(false);
    expect(owner.isUserScrolling()).toBe(true);

    // A new explicit reveal remains usable after the user took ownership.
    await act(async () => {
      api.revealPath("file-80.ts", { intent: "explicit", preserveFocus: true });
      await Promise.resolve();
    });
    await deliverScroll(scroller);
    expect(owner.isRevealActive()).toBe(true);
  });

  it("does not consume user scroll after a real reveal that needs no movement", async () => {
    const { api, owner, scroller } = await mountRealTree();
    await act(async () => {
      api.revealPath("file-00.ts", {
        intent: "explicit",
        preserveFocus: true,
        scroll: "nearest",
      });
      await Promise.resolve();
    });
    expect(scroller.scrollTop).toBe(0);
    scroller.scrollTop = 100;
    await deliverScroll(scroller);
    expect(owner.isRevealActive()).toBe(false);
    expect(owner.isUserScrolling()).toBe(true);
  });

  it("keeps reveal ownership when a host write emits an asynchronous scroll", async () => {
    const { controller, scroller } = mountController();
    const onClaim = vi.fn();
    controller.scrollOwner.subscribeUserClaim(onClaim);
    controller.beginProgrammaticScroll();
    controller.withProgrammaticScroll(() => {
      scroller.scrollTop = 240;
    });
    await deliverScroll(scroller);

    expect(onClaim).not.toHaveBeenCalled();
    expect(controller.scrollOwner.isRevealActive()).toBe(true);
    expect(controller.scrollOwner.isUserScrolling()).toBe(false);
  });

  it("lets wheel input take over before a pending host scroll event", async () => {
    const { controller, scroller } = mountController();
    controller.beginProgrammaticScroll();
    controller.withProgrammaticScroll(() => {
      scroller.scrollTop = 240;
    });
    fireEvent.wheel(scroller, { deltaY: -100 });
    await deliverScroll(scroller);

    expect(controller.scrollOwner.isRevealActive()).toBe(false);
    expect(controller.scrollOwner.isUserScrolling()).toBe(true);
  });

  it("recognizes native scrollbar movement to a different position as user input", async () => {
    const { controller, scroller } = mountController();
    controller.beginProgrammaticScroll();
    controller.withProgrammaticScroll(() => {
      scroller.scrollTop = 240;
    });
    scroller.scrollTop = 140;
    await deliverScroll(scroller);

    expect(controller.scrollOwner.isRevealActive()).toBe(false);
    expect(controller.scrollOwner.isUserScrolling()).toBe(true);
  });
});
