import { createRoot } from "react-dom/client";
import MobileWebShell from "../../.pier/canvases/mobile-web-shell/mobile-web-shell.canvas.tsx";
import DesignMockup from "../../resources/system-skills/pier-canvas/templates/design-mockup.canvas.tsx";
import WorkflowCanvas from "../../resources/system-skills/pier-canvas/templates/workflow.canvas.tsx";

const scene = new URLSearchParams(window.location.search).get("scene");
const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}

function ReviewView() {
  if (scene === "mobile") {
    return <MobileWebShell />;
  }
  if (scene === "design") {
    return <DesignMockup />;
  }
  return <WorkflowCanvas />;
}

createRoot(root).render(<ReviewView />);
