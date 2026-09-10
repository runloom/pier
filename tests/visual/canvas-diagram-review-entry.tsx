import { createRoot } from "react-dom/client";
import DesignMockup from "../../resources/system-skills/pier-canvas/templates/design-mockup.canvas.tsx";
import WorkflowCanvas from "../../resources/system-skills/pier-canvas/templates/workflow.canvas.tsx";

const scene = new URLSearchParams(window.location.search).get("scene");
const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root");
}

createRoot(root).render(
  scene === "design" ? <DesignMockup /> : <WorkflowCanvas />
);
