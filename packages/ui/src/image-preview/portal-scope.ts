import { createContext, useContext } from "react";

/**
 * Host fullscreen previews pin a fixed color mode on their overlay root
 * (token scope). Floating chrome portaled to document.body would escape that
 * scope and render in the app theme, so hosts publish their root element and
 * floating children portal into it instead. Null = default body portal.
 */
export const ImagePreviewPortalContainerContext =
  createContext<HTMLElement | null>(null);

export function useImagePreviewPortalContainer(): HTMLElement | null {
  return useContext(ImagePreviewPortalContainerContext);
}
