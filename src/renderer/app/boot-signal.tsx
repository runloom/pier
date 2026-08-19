import { useEffect } from "react";

/** First paint of this node is what unblocks the main-process window show gate. */
export function RendererBootSignal() {
  useEffect(() => {
    window.pier?.window?.readyToShow?.();
  }, []);
  return null;
}
