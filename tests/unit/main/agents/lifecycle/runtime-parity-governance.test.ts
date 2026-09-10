import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  agentLifecycleActionResultSchema,
  agentLifecycleErrorCodeSchema,
  agentLifecycleRunRequestSchema,
} from "../../../../../src/shared/contracts/agent/lifecycle.ts";

const ROOT = process.cwd();
const GOLD_SPEC = join(
  ROOT,
  "docs/superpowers/specs/2026-09-09-agent-cli-runtime-parity-gold-standard.md"
);
const AGENTS_MD = join(ROOT, "AGENTS.md");
const LIFECYCLE_SERVICE = join(
  ROOT,
  "src/main/services/agents/lifecycle/service.ts"
);
const UNINSTALL = join(
  ROOT,
  "src/main/services/agents/lifecycle/run-uninstall.ts"
);
const NODE_RUNNER = join(
  ROOT,
  "src/main/services/agents/lifecycle/runner/node.ts"
);
const RUNNER_PROCESS = join(
  ROOT,
  "src/main/services/agents/lifecycle/runner/process.ts"
);
const PES_SERVICE = join(
  ROOT,
  "src/main/services/process-environment/service.ts"
);
const APP_CORE = join(ROOT, "src/main/app-core/index.ts");
const SHELL_ENV_BOOT = join(
  ROOT,
  "src/main/app-core/shell-environment-boot.ts"
);
const LIFECYCLE_STORE = join(
  ROOT,
  "src/renderer/stores/agent-lifecycle.store.ts"
);
const AGENT_ROW = join(
  ROOT,
  "src/renderer/pages/settings/components/agent-row.tsx"
);
const PROBE_ALLOWLIST: Record<string, string> = {};

/** Third-party stderr attribution — forbidden outright. */
const ATTRIBUTION_MARKERS = [
  "requires Node",
  "detected Node",
  "EBADENGINE",
  "Unsupported engine",
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
      continue;
    }
    if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function sources(): string[] {
  return [
    ...walk(join(ROOT, "src/main/services/agents")),
    ...walk(join(ROOT, "src/main/services/process-environment")),
    ...walk(join(ROOT, "src/main/ipc")),
    ...walk(join(ROOT, "src/plugins")),
    ...walk(join(ROOT, "src/renderer")),
  ];
}

describe("agent CLI runtime parity governance", () => {
  it("locks the gold-standard doc and AGENTS.md checkpoint", () => {
    const gold = readFileSync(GOLD_SPEC, "utf8");
    expect(gold).toContain("一句话终态");
    expect(gold).toContain("明确不做");
    expect(gold).toContain("ProcessEnvironmentService.resolve");
    expect(gold).toContain("不得探 PES 构造期");
    expect(gold).toContain("安装、更新、卸载同一套");
    expect(gold).toContain("不要把宿主 `cwd` 传给它");
    expect(gold).toContain("不展示命令预览");
    expect(gold).toContain("整窗底部一份");
    const agents = readFileSync(AGENTS_MD, "utf8");
    expect(agents).toContain(
      "2026-09-09-agent-cli-runtime-parity-gold-standard.md"
    );
    expect(agents).toContain(
      "tests/unit/main/agents/lifecycle/runtime-parity-governance.test.ts"
    );
  });

  it("runs lifecycle children with the project cwd", () => {
    const service = readFileSync(LIFECYCLE_SERVICE, "utf8");
    expect(service).toMatch(/runner\.run\(activePlan, \{[^}]*cwd/s);
    const uninstall = readFileSync(UNINSTALL, "utf8");
    expect(uninstall).toMatch(/runner\.run\(planned, \{[^}]*cwd/s);
    const process = readFileSync(RUNNER_PROCESS, "utf8");
    expect(process).toMatch(/spawn\(file, \[\.\.\.args\], \{[^}]*cwd/s);
    const runner = readFileSync(NODE_RUNNER, "utf8");
    expect(runner).toContain("function spawnOptions");
    expect(runner).toMatch(/spawnOptions[\s\S]*options\.cwd/);
    const wsl = runner.slice(runner.indexOf('case "wsl"'));
    expect(wsl).not.toContain("spawnOptions");
    expect(wsl).not.toMatch(/\bcwd:/);
  });

  it("resolves agent env with the request projectRootPath", () => {
    const boot = readFileSync(SHELL_ENV_BOOT, "utf8");
    expect(boot).toContain("export function createAgentEnvResolver");
    expect(boot).toMatch(
      /processEnvironment\.resolve\(\{\s*projectRootPath: options\?\.projectRootPath,\s*source: "agent",/s
    );
    const appCore = readFileSync(APP_CORE, "utf8");
    expect(appCore).toContain(
      "const resolveAgentEnv = createAgentEnvResolver(processEnvironment);"
    );
    expect(appCore).toContain(
      "getHostNodeRuntime: (env) => processEnvironment.hostNodeRuntime(env),"
    );
    const store = readFileSync(LIFECYCLE_STORE, "utf8");
    expect(store).toContain("descriptors[activeId]?.context?.projectRootPath");
  });

  it("probes host Node through the spawn env, not the construction snapshot", () => {
    const pes = readFileSync(PES_SERVICE, "utf8");
    expect(pes).toContain("const next = env ?? lastResolvedEnv;");
    expect(pes).not.toContain("lastResolvedEnv ?? baseEnv");
    expect(pes).not.toContain("return hostNodeRuntime.probe(baseEnv);");
    const service = readFileSync(LIFECYCLE_SERVICE, "utf8");
    expect(service).toContain("hostNodeRuntime(env)");
    expect(service).toContain("getHostNodeRuntime: () => hostNodeRuntime(env)");
  });

  it("attaches hostNode on runtime failures including uninstall", () => {
    const service = readFileSync(LIFECYCLE_SERVICE, "utf8");
    expect(service).toMatch(
      /"package_manager_missing"[\s\S]*?hostNode: await hostNodeRuntime\(env\)/
    );
    expect(service).toMatch(
      /"command_failed"[\s\S]*?hostNode: await hostNodeRuntime\(env\)/
    );
    const uninstall = readFileSync(UNINSTALL, "utf8");
    expect(uninstall).toMatch(/"package_manager_missing"[\s\S]*?hostNode:/);
    expect(uninstall).toMatch(/"command_failed"[\s\S]*?hostNode:/);
    expect(service).toMatch(
      /fail\(agentId, action, "timeout", \{\s*runId,\s*commandPreview: planned\.preview,\s*\}\)/s
    );
    expect(service).toContain('return fail(agentId, action, "busy")');
    expect(uninstall).toMatch(
      /fail\(agentId, "timeout", \{\s*runId,\s*commandPreview: planned\.preview,\s*\}\)/s
    );
  });

  it("shows runtime facts in an alert, not a short toast", () => {
    const row = readFileSync(AGENT_ROW, "utf8");
    expect(row).not.toMatch(
      /if \(isLifecycleSoftFailure\(result\)\) \{\s*toast\.error/s
    );
    expect(row).toContain("hasFacts");
    expect(row).toContain("showAppAlert");
    expect(row).toContain("formatLifecycleErrorMessage");
    expect(row).toContain("includeMessage: false");
    const format = readFileSync(
      join(
        ROOT,
        "src/renderer/pages/settings/components/agent-lifecycle-format.ts"
      ),
      "utf8"
    );
    expect(format).toContain("const DETAIL_CODES");
    expect(format).not.toMatch(
      /const DETAIL_CODES = new Set\(\[[^\]]*version_unchanged/s
    );
    expect(format).toContain("formatLifecycleBatchFailureBody");
    expect(format).toContain("appendHostNodeFact: false");
    const probe = readFileSync(
      join(ROOT, "src/main/services/process-environment/host-node-runtime.ts"),
      "utf8"
    );
    expect(probe).toContain('stdio: ["ignore", "pipe", "ignore"]');
    expect(probe).toContain("...(env ? { env } : {})");
    expect(probe).toContain("runVersion(path, timeoutMs, probeEnv)");
  });

  it("keeps PES the only Node version prober", () => {
    for (const file of sources()) {
      if (file.includes("host-node-runtime.ts")) {
        continue;
      }
      const src = readFileSync(file, "utf8");
      const probesNode =
        (/["'`]node["'`]/.test(src) && src.includes("--version")) ||
        /node\s+-v\b/.test(src) ||
        /\bprocess\.version\b/.test(src);
      if (!probesNode) {
        continue;
      }
      expect(
        PROBE_ALLOWLIST[file],
        `${file} probes Node outside process-environment/host-node-runtime.ts`
      ).toBeDefined();
    }
  });

  it("never attributes third-party stderr", () => {
    const targets = sources().filter(
      (file) =>
        file.includes("/services/agents/") ||
        file.includes("/renderer/pages/settings/")
    );
    for (const file of targets) {
      const src = readFileSync(file, "utf8");
      for (const marker of ATTRIBUTION_MARKERS) {
        expect(src, `${file} matches ${marker}`).not.toContain(marker);
      }
    }
  });

  it("locks the lifecycle contract additions", () => {
    expect(agentLifecycleErrorCodeSchema.options).toContain(
      "node_requirement_unmet"
    );
    expect(agentLifecycleActionResultSchema.shape.hostNode).toBeDefined();
    expect(agentLifecycleActionResultSchema.shape.installPaths).toBeDefined();
    expect(agentLifecycleRunRequestSchema.shape.projectRootPath).toBeDefined();
  });
});
