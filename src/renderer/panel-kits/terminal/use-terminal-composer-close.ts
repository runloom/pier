import { useCallback, useEffect, useRef } from "react";

/**
 * Clear attachment rail on Esc/parent close/unmount so the next open does not
 * re-prefix stale clipboard image paths into sendText.
 */
export function useTerminalComposerClose(input: {
  clearAttachments: () => void;
  onClose: () => void;
}): () => void {
  const clearAttachmentsRef = useRef(input.clearAttachments);
  clearAttachmentsRef.current = input.clearAttachments;
  const onCloseRef = useRef(input.onClose);
  onCloseRef.current = input.onClose;

  useEffect(
    () => () => {
      clearAttachmentsRef.current();
    },
    []
  );

  return useCallback(() => {
    clearAttachmentsRef.current();
    onCloseRef.current();
  }, []);
}
