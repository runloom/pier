/**
 * W0 / acceptance E1 切片：防止「多智能体任务生命周期」进入 shared 契约公开面。
 * 完整 E1（插件/UI/持久化全库）随后续波次扩展扫描根。
 * 与 Canvas forbiddenInPier 对齐；不扫 tests/ 与文档否定句。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const CONTRACTS_ROOT = join(ROOT, "src/shared/contracts");

/** 禁止的契约文件 basename（不含扩展名语义用完整文件名）。 */
const FORBIDDEN_BASENAME =
  /^(multi-agent-run|multi-agent-task|task-ledger|orchestration-ledger|orchestration-board|orchestration-scheduler|work-item|workitem-attempt)\.ts$/i;

/**
 * 禁止作为 export type/interface/const/enum/class 名称的任务域标识。
 * 不含 shell TaskRun / TaskRuns 产品既有名。
 */
const FORBIDDEN_EXPORT_NAME =
  /^(MultiAgentRun|MultiAgentTask|MultiAgentWorkItem|TaskLedger|OrchestrationLedger|OrchestrationBoard|OrchestrationScheduler|WorkItemAttempt|AgentWorkItem|CompletionAuthority)$/;

const EXPORT_NAME_RE =
  /^export\s+(?:declare\s+)?(?:type|interface|const|enum|class|function)\s+([A-Za-z_][A-Za-z0-9_]*)/gm;

function listTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listTsFiles(full));
      continue;
    }
    if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function collectExportNames(source: string): string[] {
  const names: string[] = [];
  for (const match of source.matchAll(EXPORT_NAME_RE)) {
    const name = match[1];
    if (name) {
      names.push(name);
    }
  }
  return names;
}

describe("multi-agent boundary governance (W0 / E1 slice)", () => {
  it("src/shared/contracts 存在且可扫描", () => {
    expect(statSync(CONTRACTS_ROOT).isDirectory()).toBe(true);
  });

  it("src/shared/contracts 不新增多智能体任务生命周期公开类型文件名", () => {
    const files = listTsFiles(CONTRACTS_ROOT);
    const offenders = files
      .map((file) => basename(file))
      .filter((name) => FORBIDDEN_BASENAME.test(name));
    expect(
      offenders,
      `forbidden contract basenames: ${offenders.join(", ")}`
    ).toEqual([]);
  });

  it("src/shared/contracts 导出标识不含 MultiAgentRun/WorkItem/Attempt 任务域", () => {
    const files = listTsFiles(CONTRACTS_ROOT);
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8");
      for (const name of collectExportNames(source)) {
        if (FORBIDDEN_EXPORT_NAME.test(name)) {
          offenders.push(`${relative(ROOT, file)}:${name}`);
        }
      }
    }
    expect(offenders, `forbidden exports:\n${offenders.join("\n")}`).toEqual(
      []
    );
  });
});
