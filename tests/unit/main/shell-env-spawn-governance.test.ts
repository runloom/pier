/**
 * Spawn governance for shell-env parity (design §3 inventory A/B/C).
 * Scans main for spawn/execFile; require classification markers or allowlist.
 * First-party plugin production spawns are enforced in PR4.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../..");
const SCAN_ROOTS = [join(REPO_ROOT, "src/main")];

const SPAWN_RE =
  /\b(?:spawn|execFile|execFileSync|spawnSync)\s*(?:<[^>]*>)?\s*\(/g;

/**
 * Class B/C or pre-resolved-env call sites (design inventory).
 * New spawn sites must either resolve via PES or join this list with a reason.
 */
const ALLOWLIST_RELATIVE = new Set([
  // B: which/where probes after hostShellEnvReady
  "src/main/services/agents/detection-service.ts",
  // B: git identity uses process.env post boot apply
  "src/main/services/tasks/repo-identity.ts",
  // A-caller: receives env from background-runs resolve
  "src/main/services/tasks/background-runner.ts",
  // A-caller: receives env from processEnvironment in lifecycle
  "src/main/services/local-environment-scripts.ts",
  // Shell dump implementation
  "src/main/services/process-environment/shell-env-loader.ts",
  // C: Windows LSP supervisor (ELECTRON_RUN_AS_NODE)
  "src/main/services/lsp/windows-supervisor.ts",
  "src/main/lsp-windows-process-supervisor.ts",
  // B: LSP session / providers use process.env after boot apply (workspace
  // resolve path is PR3 optional; marked B until full workspace resolve)
  "src/main/services/lsp/session-host.ts",
  "src/main/services/lsp/providers/path-matrix-providers.ts",
  "src/main/services/lsp/providers/create-path-provider.ts",
  // B: PATH binary probe for L0 language matrix providers
  "src/main/services/lsp/resolve-command.ts",
  // B: git exec uses resolveEnvironment when wired (fallback process.env)
  "src/main/services/git/exec-raw.ts",
  // C/B: CLI path bootstrap, resource process table, ledger bookkeeping
  "src/main/adapters/cli/pier-path.ts",
  "src/main/services/pier-resource/process-table.ts",
  "src/main/state/background-task-process-ledger.ts",
  // Type-only / comment false positives
  "src/main/services/project-skills/launch-gate/types.ts",
]);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === "dist" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    let st: ReturnType<typeof statSync>;
    try {
      st = statSync(full);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

function isClassified(source: string): boolean {
  return (
    /Class\s+[ABC]\b/.test(source) ||
    source.includes("shell-env parity") ||
    source.includes("processEnvironment") ||
    source.includes("resolveEnvironment") ||
    source.includes("resolveProjectEnv") ||
    source.includes("hostShellEnvReady") ||
    source.includes("waitForHostEnv") ||
    source.includes("resolved.env") ||
    source.includes("resolvedEnvironment") ||
    /env:\s*(?:resolved|environment|opts\.env|launch\.env)/.test(source)
  );
}

describe("shell-env spawn governance", () => {
  it("every main spawn/execFile site is classified A/B/C or allowlisted", () => {
    const files = SCAN_ROOTS.flatMap((root) => walkTsFiles(root));
    const unclassified: string[] = [];

    for (const file of files) {
      const rel = relative(REPO_ROOT, file).replaceAll("\\", "/");
      if (ALLOWLIST_RELATIVE.has(rel)) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      SPAWN_RE.lastIndex = 0;
      if (!SPAWN_RE.test(source)) {
        continue;
      }
      if (!isClassified(source)) {
        unclassified.push(rel);
      }
    }

    expect(
      unclassified,
      `Unclassified spawn sites (add Class A/B/C comment or allowlist):\n${unclassified.join("\n")}`
    ).toEqual([]);
  });

  it("does not reintroduce PATH-only login shell dump as product code", () => {
    const detection = readFileSync(
      join(REPO_ROOT, "src/main/services/agents/detection-service.ts"),
      "utf8"
    );
    // Product code must not spawn `echo $PATH`; comments may mention it.
    const withoutComments = detection
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/[^\n]*/g, "");
    expect(withoutComments).not.toMatch(/echo\s+\$PATH/);
    expect(withoutComments).not.toMatch(/defaultHydratePath/);
    expect(withoutComments).toMatch(/waitForHostEnv/);
  });
});
