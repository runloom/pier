import { join } from "node:path";
import type { TaskCandidate } from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate } from "./task-candidate.ts";
import {
  asRecord,
  asString,
  commandWithArgs,
  parseJsonc,
  readTextIfExists,
} from "./utils.ts";

export interface DenoSourceOptions {
  projectRootPath: string;
}

/** deno task 值: 字符串命令, 或对象形式 { command, description }。 */
function denoTaskDescription(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  const record = asRecord(value);
  return asString(record?.description) ?? asString(record?.command);
}

function isRunnableDenoTask(value: unknown): boolean {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }
  // 对象任务可以只有 dependencies 没有 command, 同样可通过 deno task 运行。
  return asRecord(value) !== null;
}

export async function denoSource({
  projectRootPath,
}: DenoSourceOptions): Promise<TaskCandidate[]> {
  const text =
    (await readTextIfExists(join(projectRootPath, "deno.json"))) ??
    (await readTextIfExists(join(projectRootPath, "deno.jsonc")));
  if (!text) {
    return [];
  }
  const tasks = asRecord(asRecord(parseJsonc(text))?.tasks);
  if (!tasks) {
    return [];
  }
  return Object.entries(tasks)
    .filter(([, value]) => isRunnableDenoTask(value))
    .map(([name, value]) => {
      const description = denoTaskDescription(value);
      return candidate({
        commandSpec: {
          command: commandWithArgs("deno", ["task", name]),
          kind: "shell",
        },
        cwd: projectRootPath,
        ...(description ? { description } : {}),
        idParts: ["deno", name],
        label: name,
        source: "deno",
        tags: ["deno"],
      });
    });
}
