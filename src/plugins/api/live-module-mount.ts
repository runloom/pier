import type { LiveModuleFramework } from "@shared/live-module-framework.ts";
import {
  Component,
  type ComponentType,
  createElement,
  type ErrorInfo,
  type ReactNode,
} from "react";
import { createRoot, type Root } from "react-dom/client";

export type LiveModuleUnmount = () => void;

export type LiveModuleMountErrorCode =
  | "react-no-default"
  | "svelte-no-default"
  | "need-mount";

export class LiveModuleMountError extends Error {
  readonly code: LiveModuleMountErrorCode;

  constructor(code: LiveModuleMountErrorCode, message: string) {
    super(message);
    this.name = "LiveModuleMountError";
    this.code = code;
  }
}

export interface MountLiveModuleOptions {
  /** Runtime render / host error callback (React boundary + explicit mount). */
  onError?: ((error: Error) => void) | undefined;
  /** Props forwarded to a React default-export component. */
  props?: Record<string, unknown> | undefined;
  /**
   * Wrap the canvas element before rendering (React only). Canvases mount in a
   * dedicated React root, so host context providers must be injected here.
   */
  wrap?: ((node: ReactNode) => ReactNode) | undefined;
}

interface LiveModuleErrorBoundaryProps {
  children?: ReactNode | undefined;
  onError?: ((error: Error) => void) | undefined;
}

interface LiveModuleErrorBoundaryState {
  error: Error | null;
}

/**
 * Isolates canvas React trees: on render error call `onError` once and render
 * null so the host shell stays up. UI feedback is owned by the preview state.
 * Retry works via full remount (fresh root + boundary).
 */
class LiveModuleErrorBoundary extends Component<
  LiveModuleErrorBoundaryProps,
  LiveModuleErrorBoundaryState
> {
  private reported = false;

  constructor(props: LiveModuleErrorBoundaryProps) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): LiveModuleErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, _info: ErrorInfo): void {
    if (this.reported) {
      return;
    }
    this.reported = true;
    scheduleMountError(this.props.onError, error);
  }

  override render(): ReactNode {
    if (this.state.error) {
      return null;
    }
    return this.props.children ?? null;
  }
}

function reportMountError(
  onError: ((error: Error) => void) | undefined,
  error: unknown
): void {
  onError?.(error instanceof Error ? error : new Error(String(error)));
}

/** Notify the host after the canvas root leaves render/commit. */
function scheduleMountError(
  onError: ((error: Error) => void) | undefined,
  error: unknown
): void {
  queueMicrotask(() => {
    reportMountError(onError, error);
  });
}

const liveRoots = new WeakMap<HTMLElement, Root>();

function unmountLiveRoot(el: HTMLElement, root: Root): void {
  if (liveRoots.get(el) !== root) {
    return;
  }
  liveRoots.delete(el);
  root.unmount();
}

/**
 * Mount a React component (default-export shape) into `el`.
 *
 * `createRoot().render()` is concurrent. Unmounting that root from
 * `componentDidCatch` / `onUncaughtError` / the same turn as `render()` trips
 * React's "synchronously unmount a root while React was already rendering"
 * race and can leave the previous canvas painted.
 */
export function mountLiveModule<P = Record<string, unknown>>(
  el: HTMLElement,
  Comp: ComponentType<P>,
  options: MountLiveModuleOptions = {}
): LiveModuleUnmount {
  const previous = liveRoots.get(el);
  if (previous) {
    liveRoots.delete(el);
    previous.unmount();
  }
  const root: Root = createRoot(el, {
    onUncaughtError: (error) => {
      scheduleMountError(options.onError, error);
    },
  });
  liveRoots.set(el, root);
  renderLiveModuleTree(root, Comp, options);
  let closed = false;
  return () => {
    if (closed) {
      return;
    }
    closed = true;
    queueMicrotask(() => {
      unmountLiveRoot(el, root);
    });
  };
}

/**
 * Re-render an already-mounted React live module with new props. Plugin applets
 * change `provider` / `repo` on source switch; tearing down the root recompiles
 * and feels like a stall. Returns false when `el` has no live root.
 */
export function updateLiveModule<P = Record<string, unknown>>(
  el: HTMLElement,
  Comp: ComponentType<P>,
  options: MountLiveModuleOptions = {}
): boolean {
  const root = liveRoots.get(el);
  if (!root) {
    return false;
  }
  renderLiveModuleTree(root, Comp, options);
  return true;
}

function renderLiveModuleTree<P>(
  root: Root,
  Comp: ComponentType<P>,
  options: MountLiveModuleOptions
): void {
  const inner = createElement(
    Comp as ComponentType<Record<string, unknown>>,
    options.props ?? null
  );
  const wrapped = options.wrap ? options.wrap(inner) : inner;
  root.render(
    createElement(
      LiveModuleErrorBoundary,
      { onError: options.onError },
      wrapped
    )
  );
}

/**
 * Mount conventions (all frameworks):
 * - Preferred: `export function mount(el, host?): unmount` (Vue/Svelte inject this; Solid authors write it)
 * - React: `export default function Comp()` also works
 * - Svelte: `export default Component` (class with $destroy) also works
 */
export async function mountLiveModuleExport(
  el: HTMLElement,
  framework: LiveModuleFramework,
  mod: Record<string, unknown>,
  options: MountLiveModuleOptions = {}
): Promise<LiveModuleUnmount> {
  const explicitMount = mod.mount;
  if (typeof explicitMount === "function") {
    const stop = (
      explicitMount as (
        node: HTMLElement,
        host?: { onError?: ((error: Error) => void) | undefined }
      ) => unknown
    )(el, { onError: options.onError });
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
      throw new LiveModuleMountError(
        "react-no-default",
        "React canvas must default-export a component (or export mount(el))"
      );
    }
    return mountLiveModule(el, Comp as ComponentType, options);
  }

  if (framework === "svelte") {
    const Comp = mod.default as
      | (new (opts: {
          target: Element;
        }) => { $destroy: () => void })
      | undefined;
    if (!Comp) {
      throw new LiveModuleMountError(
        "svelte-no-default",
        "Svelte canvas must default-export a component or export mount(el)"
      );
    }
    const instance = new Comp({ target: el });
    return () => {
      instance.$destroy();
      el.replaceChildren();
    };
  }

  throw new LiveModuleMountError(
    "need-mount",
    `${framework} canvas should export function mount(el) { ...; return unmount } so the host can attach project-bundled runtime (vue/solid). React may default-export a component.`
  );
}
