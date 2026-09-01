import { type RefObject, useEffect, useRef, useState } from "react";
import { isEditableOrControl } from "./canvas-math.ts";

/** Space-to-pan: hold space while the world viewport is focused or hovered. */
export function useWorldCameraSpacePan(
  enabled: boolean,
  viewportRef: RefObject<HTMLElement | null>
): {
  spacePressed: boolean;
  spacePressedRef: RefObject<boolean>;
} {
  const [spacePressed, setSpacePressed] = useState(false);
  const spacePressedRef = useRef(false);
  spacePressedRef.current = spacePressed;

  useEffect(() => {
    if (!enabled) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.code === "Space" || event.key === " ")) {
        return;
      }
      if (isEditableOrControl(document.activeElement)) {
        return;
      }
      const viewport = viewportRef.current;
      if (!viewport) {
        return;
      }
      if (
        document.activeElement === viewport ||
        viewport.contains(document.activeElement) ||
        viewport.matches(":hover")
      ) {
        event.preventDefault();
        if (!spacePressedRef.current) {
          setSpacePressed(true);
        }
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (
        (event.code === "Space" || event.key === " ") &&
        spacePressedRef.current
      ) {
        setSpacePressed(false);
      }
    };
    const onBlur = () => {
      if (spacePressedRef.current) {
        setSpacePressed(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, [enabled, viewportRef]);

  return { spacePressed, spacePressedRef };
}
