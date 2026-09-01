import { Frame } from "pier/canvas";
import TaskList from "@pier-applet/pier.tasks/task-list";

/** Named slice island. Project-wide tracking is ⌘N → Task tracker. */
export const canvas = {
  kind: "composition",
  title: "Task list",
};

export default function TaskListCanvas() {
  return (
    <Frame>
      <TaskList />
    </Frame>
  );
}
