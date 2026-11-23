import { type RefObject, useCallback } from "react";
import {
  GutterHoverTooltip,
  type GutterTooltipPointer,
  useGutterHoverTooltip,
} from "./hover-tooltip.tsx";

const SOURCE_GUTTER_TARGET_SELECTOR =
  ".cm-gitRow-added, .cm-gitRow-modified, .cm-gitRow-deleted";

/** One delayed tooltip for the virtualized CM gutter; no per-line Tab stops. */
export function SourceGutterTooltip({
  rootRef,
  label,
  enabled,
}: {
  rootRef: RefObject<HTMLElement | null>;
  label: string;
  enabled: boolean;
}) {
  const getRoot = useCallback(() => rootRef.current, [rootRef]);
  const resolveAnchor = useCallback(
    (target: Element, { root }: GutterTooltipPointer) => {
      const rect = target.getBoundingClientRect();
      const bounds = root.getBoundingClientRect();
      return {
        top: rect.top - bounds.top,
        left: rect.left - bounds.left,
        height: rect.height,
        width: 16,
      };
    },
    []
  );
  const anchor = useGutterHoverTooltip({
    enabled,
    getRoot,
    resolveAnchor,
    selector: SOURCE_GUTTER_TARGET_SELECTOR,
  });
  return <GutterHoverTooltip anchor={anchor} label={label} />;
}
