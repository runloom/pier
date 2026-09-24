import { join } from "node:path";
import type { TaskCandidate } from "@shared/contracts/tasks.ts";
import { taskCandidate as candidate } from "./candidate.ts";
import { composerSetupTasks } from "./setup-commands.ts";
import {
  asRecord,
  type CommandExists,
  commandWithArgs,
  readTextIfExists,
} from "./utils.ts";

export interface ComposerSourceOptions {
  commandExists?: CommandExists;
  projectRootPath: string;
}

/**
 * composer scripts 里的标准事件钩子 (pre-install-cmd / post-update-cmd /
 * pre-autoload-dump 等) 由 composer 生命周期自动触发, 不是用户主动运行的
 * 任务, 从列表排除; 自定义脚本名不受影响。
 */
const COMPOSER_EVENT_HOOK_RE =
  /^(?:pre|post)-(?:install|update|status|archive|autoload-dump|root-package-install|create-project-cmd|dependencies-solving)/;

function composerScriptDescription(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
    return value.join(" && ");
  }
  return;
}

export async function composerSource({
  commandExists,
  projectRootPath,
}: ComposerSourceOptions): Promise<TaskCandidate[]> {
  const text = await readTextIfExists(join(projectRootPath, "composer.json"));
  if (!text) {
    return [];
  }
  const scripts = asRecord(asRecord(JSON.parse(text))?.scripts) ?? {};
  const declared = Object.entries(scripts)
    .filter(([name]) => !COMPOSER_EVENT_HOOK_RE.test(name))
    .map(([name, value]) => {
      const description = composerScriptDescription(value);
      return candidate({
        commandSpec: {
          command: commandWithArgs("composer", ["run-script", name]),
          kind: "shell",
        },
        cwd: projectRootPath,
        ...(description ? { description } : {}),
        idParts: ["composer", name],
        label: name,
        source: "composer",
        tags: ["php"],
      });
    });
  const setup = await composerSetupTasks({
    ...(commandExists ? { commandExists } : {}),
    declaredLabels: new Set(declared.map((task) => task.label)),
    projectRootPath,
  });
  return [...setup, ...declared];
}
