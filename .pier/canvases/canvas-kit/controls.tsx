import { Stack } from "pier/canvas";
import { ActionControls } from "./controls-action.tsx";
import { FeedbackControls } from "./controls-feedback.tsx";
import { FormControls } from "./controls-form.tsx";
import { OverlayControls } from "./controls-overlay.tsx";

export function ControlsPage() {
  return (
    <Stack gap={20}>
      <ActionControls />
      <FormControls />
      <FeedbackControls />
      <OverlayControls />
    </Stack>
  );
}
