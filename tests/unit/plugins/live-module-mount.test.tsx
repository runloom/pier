// @vitest-environment jsdom
import {
  mountLiveModule,
  updateLiveModule,
} from "@plugins/api/live-module-mount.ts";
import { act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const UNMOUNT_DURING_RENDER = /synchronously unmount a root/iu;

function collectConsoleErrors(): { errors: string[]; restore: () => void } {
  const errors: string[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args.map(String).join(" "));
    original.apply(console, args);
  };
  return {
    errors,
    restore: () => {
      console.error = original;
    },
  };
}

describe("mountLiveModule", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not unmount the canvas root during its own render when onError tears down", async () => {
    const spy = collectConsoleErrors();
    const el = document.createElement("div");
    document.body.append(el);
    function Boom(): never {
      throw new Error("canvas render boom");
    }
    const unmountRef: { current: (() => void) | null } = { current: null };
    const onError = vi.fn(() => {
      unmountRef.current?.();
    });
    await act(async () => {
      const unmount = mountLiveModule(el, Boom, { onError });
      unmountRef.current = unmount;
      await Promise.resolve();
      await Promise.resolve();
    });
    spy.restore();
    expect(onError).toHaveBeenCalledOnce();
    expect(spy.errors.join("\n")).not.toMatch(UNMOUNT_DURING_RENDER);
  });

  it("allows unmount in the same turn as mount without the render-race warning", async () => {
    const spy = collectConsoleErrors();
    const el = document.createElement("div");
    document.body.append(el);
    function Hello() {
      return <span>hi</span>;
    }
    await act(async () => {
      const unmount = mountLiveModule(el, Hello);
      unmount();
      await Promise.resolve();
    });
    spy.restore();
    expect(spy.errors.join("\n")).not.toMatch(UNMOUNT_DURING_RENDER);
  });

  it("updates props on an existing root without remounting", async () => {
    const el = document.createElement("div");
    document.body.append(el);
    function Hello({ name }: { name: string }) {
      return <span>{name}</span>;
    }
    await act(async () => {
      mountLiveModule(el, Hello, { props: { name: "alpha" } });
      await Promise.resolve();
    });
    expect(el.textContent).toBe("alpha");
    const node = el.querySelector("span");
    await act(async () => {
      expect(updateLiveModule(el, Hello, { props: { name: "beta" } })).toBe(
        true
      );
      await Promise.resolve();
    });
    expect(el.textContent).toBe("beta");
    expect(el.querySelector("span")).toBe(node);
  });

  it("returns false when the element has no live root", () => {
    const el = document.createElement("div");
    function Hello() {
      return <span>hi</span>;
    }
    expect(updateLiveModule(el, Hello)).toBe(false);
  });
});
