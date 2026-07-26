import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import type { ComponentType } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

export type LiveModuleUnmount = () => void;

/**
 * Mount a React component (default-export shape) into `el`.
 */
export function mountLiveModule(
  el: HTMLElement,
  Comp: ComponentType
): LiveModuleUnmount {
  const root: Root = createRoot(el);
  root.render(createElement(Comp));
  return () => {
    root.unmount();
  };
}

/**
 * Mount conventions (all frameworks):
 * - Preferred: `export function mount(el): unmount` (Vue/Svelte inject this; Solid authors write it)
 * - React: `export default function Comp()` also works
 * - Svelte: `export default Component` (class with $destroy) also works
 */
export async function mountLiveModuleExport(
  el: HTMLElement,
  framework: LiveModuleFramework,
  mod: Record<string, unknown>
): Promise<LiveModuleUnmount> {
  const explicitMount = mod.mount;
  if (typeof explicitMount === "function") {
    const stop = (explicitMount as (node: HTMLElement) => unknown)(el);
    if (typeof stop === "function") {
      return stop as LiveModuleUnmount;
    }
    return () => {
      el.replaceChildren();
    };
  }

  if (framework === "react") {
    const Comp = mod.default;
    if (typeof Comp !== "function") {
      throw new Error(
        "React canvas must default-export a component (or export mount(el))"
      );
    }
    return mountLiveModule(el, Comp as ComponentType);
  }

  if (framework === "svelte") {
    const Comp = mod.default as
      | (new (opts: {
          target: Element;
        }) => { $destroy: () => void })
      | undefined;
    if (!Comp) {
      throw new Error(
        "Svelte canvas must default-export a component or export mount(el)"
      );
    }
    const instance = new Comp({ target: el });
    return () => {
      instance.$destroy();
      el.replaceChildren();
    };
  }

  throw new Error(
    `${framework} canvas should export function mount(el) { ...; return unmount } so the host can attach project-bundled runtime (vue/solid). React may default-export a component.`
  );
}
