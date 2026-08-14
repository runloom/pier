import { useEffect, useRef, useState } from "react";

/**
 * Minimum visible spin duration for a busy flag.
 *
 * `busy` going true starts spinning immediately. `busy` going false only
 * delays the *visual* spin-out so very fast refreshes still read as "the
 * button responded" — it never delays the underlying state, content updates
 * or disabled state.
 */
export function useMinSpinVisual(busy: boolean, minMs = 300): boolean {
  const [spinning, setSpinning] = useState(busy);
  const startedAtRef = useRef<number | null>(null);

  useEffect(() => {
    if (busy) {
      startedAtRef.current = Date.now();
      setSpinning(true);
      return;
    }
    if (startedAtRef.current === null) {
      return;
    }
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed >= minMs) {
      startedAtRef.current = null;
      setSpinning(false);
      return;
    }
    const timer = setTimeout(() => {
      startedAtRef.current = null;
      setSpinning(false);
    }, minMs - elapsed);
    return () => clearTimeout(timer);
  }, [busy, minMs]);

  return spinning;
}
