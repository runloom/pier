import {
  createContext,
  createElement,
  type ReactNode,
  useContext,
} from "react";

/**
 * Identity of the file a canvas was mounted from.
 *
 * The host owns this: a canvas never learns the project root or its own path
 * from its bundle, so `pier/canvas` write helpers read the scope from here and
 * refuse to act when it is absent (component tests, previews without a file).
 */
export interface LiveModuleCanvasFileScope {
  /** Project-relative directory holding the canvas, `""` at a content root. */
  directory: string;
  /** Project-relative path of the canvas file. */
  path: string;
  /** File-service root (project root path). */
  root: string;
}

const CanvasFileScopeContext = createContext<LiveModuleCanvasFileScope | null>(
  null
);

export function LiveModuleCanvasFileScopeProvider(props: {
  children: ReactNode;
  scope: LiveModuleCanvasFileScope;
}) {
  return createElement(
    CanvasFileScopeContext.Provider,
    { value: props.scope },
    props.children
  );
}

export function useLiveModuleCanvasFileScope(): LiveModuleCanvasFileScope | null {
  return useContext(CanvasFileScopeContext);
}

/**
 * Wrapper for `mountLiveModuleExport`. Canvases mount in their own React root,
 * so the scope has to be provided inside that root rather than around the panel.
 */
export function liveModuleCanvasFileScopeWrapper(
  scope: LiveModuleCanvasFileScope
): (node: ReactNode) => ReactNode {
  return (node) =>
    createElement(CanvasFileScopeContext.Provider, { value: scope }, node);
}
