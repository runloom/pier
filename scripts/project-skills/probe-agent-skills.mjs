#!/usr/bin/env node
/**
 * S0 probe: print local agent CLI presence/version and record relative
 * symlink fixture assumptions for project skill discovery roots.
 *
 * Does not require every agent to be installed. Missing binaries are skipped
 * with an explicit status so CI and developer machines can both run it.
 *
 * Usage:
 *   node scripts/project-skills/probe-agent-skills.mjs
 *   node scripts/project-skills/probe-agent-skills.mjs --json
 */
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readlinkSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

/** @typedef {{ id: string, binaries: string[], versionArgs: string[] }} AgentProbe */

/** @type {AgentProbe[]} */
const AGENTS = [
  {
    id: "codex",
    binaries: ["codex"],
    versionArgs: ["--version"],
  },
  {
    id: "claude",
    binaries: ["claude"],
    versionArgs: ["--version"],
  },
  {
    id: "cursor",
    binaries: ["cursor", "cursor-agent"],
    versionArgs: ["--version"],
  },
  {
    id: "opencode",
    binaries: ["opencode"],
    versionArgs: ["--version"],
  },
];

/**
 * Official project discovery roots from design §2.1.
 * Paths are relative to the project root.
 */
const DISCOVERY_ROOTS = {
  codex: [".agents/skills"],
  claude: [".claude/skills"],
  opencode: [".agents/skills", ".claude/skills", ".opencode/skills"],
  cursor: [
    ".agents/skills",
    ".cursor/skills",
    ".claude/skills",
    ".codex/skills",
  ],
};

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, timeoutMs?: number }} [opts]
 */
function runCapture(command, args, opts = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    cwd: opts.cwd,
    timeout: opts.timeoutMs ?? 8000,
    env: process.env,
  });
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return {
    status: result.status,
    error: result.error ? String(result.error.message ?? result.error) : null,
    stdout,
    stderr,
    combined: [stdout, stderr].filter(Boolean).join("\n"),
  };
}

/**
 * @param {string} binary
 * @returns {string | null}
 */
function resolveWhich(binary) {
  const result = runCapture("which", [binary], { timeoutMs: 3000 });
  if (result.status !== 0 || !result.stdout) return null;
  const first = result.stdout
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);
  return first ?? null;
}

/**
 * @param {AgentProbe} agent
 */
function probeAgent(agent) {
  /** @type {{ binary: string, path: string | null, version: string | null, skipped: boolean, reason?: string }[]} */
  const attempts = [];

  for (const binary of agent.binaries) {
    const path = resolveWhich(binary);
    if (!path) {
      attempts.push({
        binary,
        path: null,
        version: null,
        skipped: true,
        reason: "not-found-on-PATH",
      });
      continue;
    }

    const versionRun = runCapture(path, agent.versionArgs);
    const versionText =
      versionRun.combined ||
      (versionRun.error
        ? `error: ${versionRun.error}`
        : "(empty version output)");

    attempts.push({
      binary,
      path,
      version: versionText,
      skipped: false,
    });
  }

  const hit = attempts.find((item) => !item.skipped);
  return {
    id: agent.id,
    discoveryRoots: DISCOVERY_ROOTS[agent.id] ?? [],
    installed: Boolean(hit),
    selectedBinary: hit?.binary ?? null,
    selectedPath: hit?.path ?? null,
    version: hit?.version ?? null,
    attempts,
  };
}

/**
 * Create a temporary project fixture with a relative directory symlink under
 * a discovery root, matching Pier's intended projection shape.
 *
 * Does not invoke agent CLIs against the fixture (agents may not be installed
 * or may refuse non-interactive skill listing). Records filesystem facts that
 * the managed projection model depends on.
 *
 * @returns {Record<string, unknown>}
 */
function probeRelativeSymlinkFixture() {
  const root = mkdtempSync(join(tmpdir(), "pier-project-skills-s0-"));
  const skillId = "sample-skill";
  const libraryDir = join(root, ".pier", "skills", "library", skillId);
  const projectionParent = join(root, ".agents", "skills");
  const projectionPath = join(projectionParent, skillId);
  const skillFile = join(libraryDir, "SKILL.md");

  try {
    mkdirSync(libraryDir, { recursive: true });
    mkdirSync(projectionParent, { recursive: true });
    writeFileSync(
      skillFile,
      [
        "---",
        `name: ${skillId}`,
        "description: S0 relative symlink fixture for project skills discovery.",
        "---",
        "",
        "# Sample skill",
        "",
        "Fixture only.",
        "",
      ].join("\n"),
      "utf8"
    );

    // Relative link from .agents/skills/<id> -> ../../.pier/skills/library/<id>
    const relativeTarget = relative(projectionParent, libraryDir);
    symlinkSync(relativeTarget, projectionPath);

    const linkStat = lstatSync(projectionPath);
    const linkTarget = readlinkSync(projectionPath);
    const resolved = realpathSync(projectionPath);
    const skillViaLink = realpathSync(join(projectionPath, "SKILL.md"));
    const skillCanonical = realpathSync(skillFile);

    const posixRelative = relativeTarget.split(sep).join("/");
    const isRelativeLink = !(
      linkTarget.startsWith("/") || /^[A-Za-z]:[\\/]/.test(linkTarget)
    );

    return {
      ok: true,
      root,
      skillId,
      projectionPath: `.agents/skills/${skillId}`,
      linkTargetRaw: linkTarget,
      linkTargetPosix: posixRelative,
      isSymbolicLink: linkStat.isSymbolicLink(),
      isRelativeLink,
      resolvesToLibrary: resolved === realpathSync(libraryDir),
      skillReadableViaLink: skillViaLink === skillCanonical,
      assumption:
        "Relative directory symlinks under .agents/skills and .claude/skills are the intended managed projection shape. Official docs state Codex and Claude Code support skill-directory symlinks; minimum versions must be confirmed on the host running this probe, not hard-coded from third-party tables. OpenCode/Cursor multi-root scanners can surface the same skill more than once when Claude delivery is enabled (duplicate-discovery).",
    };
  } catch (error) {
    return {
      ok: false,
      root,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    try {
      rmSync(root, { recursive: true, force: true });
    } catch {
      // Best-effort cleanup; probe result already captured.
    }
  }
}

/**
 * @param {string[]} argv
 */
function parseArgs(argv) {
  return {
    json: argv.includes("--json"),
  };
}

/**
 * @param {ReturnType<typeof buildReport>} report
 */
function printHuman(report) {
  console.log("Project skills S0 agent probe");
  console.log(`checkedAt: ${report.checkedAt}`);
  console.log(`platform: ${report.platform}`);
  console.log("");
  console.log("Agents:");
  for (const agent of report.agents) {
    const roots = agent.discoveryRoots.join(", ");
    if (!agent.installed) {
      console.log(`- ${agent.id}: skipped (not installed on PATH)`);
      console.log(`  discoveryRoots: ${roots}`);
      continue;
    }
    console.log(`- ${agent.id}: installed`);
    console.log(`  binary: ${agent.selectedBinary}`);
    console.log(`  path: ${agent.selectedPath}`);
    console.log(`  version: ${agent.version?.split("\n").join(" | ")}`);
    console.log(`  discoveryRoots: ${roots}`);
  }
  console.log("");
  console.log("Symlink fixture:");
  const symlink = report.symlinkFixture;
  if (!symlink.ok) {
    console.log(`- failed: ${symlink.error}`);
    return;
  }
  console.log(`- projection: ${symlink.projectionPath}`);
  console.log(`- linkTarget: ${symlink.linkTargetPosix}`);
  console.log(`- isSymbolicLink: ${symlink.isSymbolicLink}`);
  console.log(`- isRelativeLink: ${symlink.isRelativeLink}`);
  console.log(`- resolvesToLibrary: ${symlink.resolvesToLibrary}`);
  console.log(`- skillReadableViaLink: ${symlink.skillReadableViaLink}`);
  console.log(`- note: ${symlink.assumption}`);
  console.log("");
  console.log("Launch gate note:");
  console.log(
    "- All managed agent processes that may use a project cwd and consume project skills must enter ManagedAgentLaunchGate before native surface / PTY / one-shot CLI start."
  );
}

function buildReport() {
  return {
    checkedAt: new Date().toISOString(),
    platform: `${process.platform}/${process.arch}`,
    node: process.version,
    agents: AGENTS.map(probeAgent),
    discoveryRootsByAgent: DISCOVERY_ROOTS,
    symlinkFixture: probeRelativeSymlinkFixture(),
    managedAgentLaunchGate:
      "ManagedAgentLaunchGate is the sole hard gate for managed agent launches that may consume project skills from a project working directory.",
  };
}

/**
 * @param {string[]} [argv]
 */
function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const report = buildReport();
  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    printHuman(report);
  }
  const symlinkOk = report.symlinkFixture && report.symlinkFixture.ok === true;
  process.exitCode = symlinkOk ? 0 : 1;
}

const isMain =
  process.argv[1] != null &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
  main();
}

export {
  AGENTS,
  buildReport,
  DISCOVERY_ROOTS,
  main,
  parseArgs,
  probeAgent,
  probeRelativeSymlinkFixture,
  resolveWhich,
  runCapture,
};
