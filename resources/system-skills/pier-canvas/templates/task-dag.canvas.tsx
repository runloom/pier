import { Frame } from "pier/canvas";
import TaskGraph from "@pier-applet/pier.tasks/task-dag";

/** Named slice island. Project-wide tracking is ⌘N → Task tracker. */
export const canvas = {
  kind: "composition",
  title: "Task graph",
};

export default function TaskDagCanvas() {
  return (
    <Frame>
      <TaskGraph />
    </Frame>
  );
}
