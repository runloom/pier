import { useCallback, useState } from "react";
import type { ReviewViewOptions } from "./document/ui-state.ts";
import { resolveResponsiveDiffStyle } from "./responsive-diff.ts";

interface ReviewViewOptionsBinding {
  readonly options: ReviewViewOptions;
  readonly setOptions: (patch: Partial<ReviewViewOptions>) => void;
}

interface ReviewResponsiveState {
  readonly contentWidthPx: number | null;
  readonly responsiveUnified: boolean;
}

export function useReviewResponsiveViewOptions({
  options,
  setOptions,
}: ReviewViewOptionsBinding): {
  readonly effectiveOptions: ReviewViewOptions;
  readonly onContentResize: (widthPx: number) => void;
  readonly setOptions: (patch: Partial<ReviewViewOptions>) => void;
} {
  const [responsiveState, setResponsiveState] = useState<ReviewResponsiveState>(
    {
      contentWidthPx: null,
      responsiveUnified: false,
    }
  );
  const responsiveDiff = resolveResponsiveDiffStyle({
    preferredDiffStyle: options.diffStyle,
    contentWidthPx: responsiveState.contentWidthPx,
    responsiveUnified: responsiveState.responsiveUnified,
  });
  const onContentResize = useCallback(
    (contentWidthPx: number) => {
      setResponsiveState((current) => {
        const resolved = resolveResponsiveDiffStyle({
          preferredDiffStyle: options.diffStyle,
          contentWidthPx,
          responsiveUnified: current.responsiveUnified,
        });
        if (
          current.contentWidthPx === contentWidthPx &&
          current.responsiveUnified === resolved.responsiveUnified
        ) {
          return current;
        }
        return {
          contentWidthPx,
          responsiveUnified: resolved.responsiveUnified,
        };
      });
    },
    [options.diffStyle]
  );
  const setResponsiveOptions = useCallback(
    (patch: Partial<ReviewViewOptions>) => {
      setResponsiveState((current) => {
        const resolved = resolveResponsiveDiffStyle({
          preferredDiffStyle: patch.diffStyle ?? options.diffStyle,
          contentWidthPx: current.contentWidthPx,
          responsiveUnified: current.responsiveUnified,
        });
        if (current.responsiveUnified === resolved.responsiveUnified) {
          return current;
        }
        return {
          ...current,
          responsiveUnified: resolved.responsiveUnified,
        };
      });
      setOptions(patch);
    },
    [options.diffStyle, setOptions]
  );
  return {
    effectiveOptions: {
      ...options,
      diffStyle: responsiveDiff.effectiveDiffStyle,
    },
    onContentResize,
    setOptions: setResponsiveOptions,
  };
}
