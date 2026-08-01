#!/usr/bin/env node
/**
 * Reorganize flat tests into domain subfolders for the directory density gate.
 *
 * Dry-run: node scripts/reorg-test-dir-density.mjs
 * Apply:   node scripts/reorg-test-dir-density.mjs --apply
 */
import {
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/**
 * @param {string} name
 * @param {[string, RegExp][]} rules
 */
function classify(name, rules) {
  for (const [bucket, re] of rules) {
    if (re.test(name)) {
      return bucket;
    }
  }
  return "misc";
}

/** @type {Record<string, [string, RegExp][]>} */
const RULES = {
  "tests/unit/renderer": [
    ["files/editor", /^(file-editor|code-mirror|cm-|files-cm-|files-editor)/],
    ["files/tree", /^(file-tree|files-tree|files-sidebar|files-directory)/],
    [
      "files/document",
      /^(file-document|files-document|files-draft|file-draft)/,
    ],
    [
      "files/search",
      /^(files-content-search|files-search|files-path-query|files-quick-open)/,
    ],
    ["files/lsp", /^(files-lsp|file-lsp)/],
    ["files/markdown", /^markdown-/],
    [
      "files/panel",
      /^(file-panel|files-panel|files-group|files-open|files-disk|open-disk-file)/,
    ],
    ["files", /^(file-|files-|use-file|use-files)/],
    ["git/review", /^(git-review-|use-git-review)/],
    ["git", /^(git-|use-git|diff-view|pier-diff|git-diff)/],
    [
      "terminal",
      /^(terminal-|composer-|tui-|use-terminal|use-composer|use-agent-composer|agent-result|agent-status|mention-popup|structured-composer)/,
    ],
    [
      "plugins",
      /^(plugin-|external-|managed-|builtin-|host-|runtime-plugin|resolve-plugin|mermaid-)/,
    ],
    ["accounts", /^(claude-|codex-|grok-|account-|format-account)/],
    [
      "workbench",
      /^(workbench-|use-workbench|metric-|widget-|core-cost|core-workbench|cost-|custom-card|kpi-|activity-|system-resources)/,
    ],
    [
      "workspace",
      /^(workspace-|panel-|dockview-|add-panel|sanitize-saved|freeze-floating)/,
    ],
    [
      "settings",
      /^(settings-|appearance-|keybinding-|environment-|skills-|project-skills|agents-section|plugins-section|lsp-settings)/,
    ],
    [
      "notifications",
      /^(notification-|app-dialog|app-content-dialog|system-notify|show-notification|play-attention|notifications-policy)/,
    ],
    ["agent", /^(agent-|foreground-activity|attention-|new-agent)/],
    ["tasks", /^(task-|notify-task|open-task|should-retain-task)/],
    [
      "command-palette",
      /^(command-palette|command-|action-|view-actions|renderer-action|context-menu-action)/,
    ],
    [
      "app",
      /^(app-|startup-|shell-|title-bar|document-title|gpu-|overlay-|shadcn|color-|interactive-|chart-|user-copy|dialog-|widget-size|scroll-area|governance|modal-layer|no-backdrop|select-group|progress-|auto-hide|ui-format|current-window|window-focus|schedule-after|use-deferred|content-preview|image-preview|source-editor|canvas-|pier-canvas|live-modules|ssh-|text-input|usage-data)/,
    ],
    ["stores", /(\.store\.|store-)/],
  ],
  "tests/unit/main": [
    ["terminal", /^terminal-/],
    ["git/review", /^git-review-/],
    ["git", /^(git-|worktree-)/],
    [
      "project-skills",
      /^(project-skills|pier-home|skill-|pier-bindings|ai-service-skills)/,
    ],
    ["lsp", /^lsp-/],
    ["agents/claude", /^claude-/],
    ["agents/codex", /^codex-/],
    ["agents/grok", /^grok-/],
    ["agents/usage", /^(usage-|account-usage)/],
    ["agents/hooks", /^hook-/],
    [
      "agents",
      /^(agent-|hermes-|attention-|assemble-sessions|resolve-session|claim-login|jsonl-|blank-command|peer-sync|agents-prepare)/,
    ],
    [
      "plugins",
      /^(plugin-|managed-|bundled-|external-plugin|external-main|workspace-dev-plugins|ssh-plugin)/,
    ],
    ["files", /^(file-|files-)/],
    [
      "app-core",
      /^(app-|command-|window-|permissions|lazy-app|ipc-command|menu-|settings-menu|devtools|csp|asset-protocol|renderer-recovery|native-window|startup-diagnostics|local-control)/,
    ],
    [
      "notification",
      /^(notification-|system-notification|message-toast|sound-asset)/,
    ],
    ["panel", /^(panel-|foreground-activity)/],
    ["live-modules", /^live-modules/],
    ["tasks", /^(task-|background-task)/],
    [
      "preferences",
      /^(preferences-|debounced-store|versioned-store|identity-registry|process-environment|local-environment|host-memory|process-table|lru-|daily-diagnostics|map-app-metrics|pricing-|update-model|github-latest|mac-release|account-usage|clipboard|external-navigation)/,
    ],
  ],
  "tests/unit/shared": [
    ["agent", /^(agent-|plugin-)/],
    ["terminal", /^terminal-/],
    ["git", /^git-/],
    ["file", /^file-/],
    ["task", /^task-/],
    ["lsp", /^lsp-/],
    ["notification", /^notification-/],
    ["panel", /^panel-/],
    [
      "app",
      /^(app-|workbench|worktree|managed|logger|live|ipc|environment|utf8|pier)/,
    ],
  ],
  "tests/component": [
    ["workbench", /^workbench-/],
    ["workspace", /^workspace-/],
    ["settings", /^settings-/],
    ["command-palette", /^command-/],
    ["notifications", /^notification-/],
    ["files", /^(files-|file-|ui-file)/],
    ["git", /^git-/],
    ["terminal", /^terminal-/],
    [
      "app",
      /^(app-|title-|startup-|welcome|panel|plugin|project|system|tooltip|ui-|cost-|pier-|worktree)/,
    ],
  ],
  "tests/e2e": [
    ["workbench", /^workbench-/],
    ["git", /^git-/],
    ["files", /^files-/],
    ["lsp", /^lsp-/],
    ["terminal", /^terminal-/],
    ["panel", /^panel-/],
    ["notifications", /^notification-/],
    ["native", /^native-/],
    ["agents", /^(agent|agents|codex)/],
    ["app", /^(startup|plugin|command)/],
  ],
  "tests/unit": [
    ["native", /^native-/],
    ["agent", /^agent-/],
    ["terminal", /^terminal-/],
    ["command", /^command-/],
    [
      "app",
      /^(setup|dev|zoom|worktree|window|task|preferences|permissions|panel|keybinding|font|default|cwd|cmd|claude)/,
    ],
  ],
};

/**
 * @param {string} content
 * @param {string} fromAbs
 * @param {string} toAbs
 */
function rewriteRelativeImports(content, fromAbs, toAbs) {
  return content.replace(
    /(from\s+['"])(\.\.[^'"]+|\.\/[^'"]+)(['"])/g,
    (_full, a, spec, c) => {
      const targetAbs = join(dirname(fromAbs), spec);
      let relToNew = relative(dirname(toAbs), targetAbs).split(sep).join("/");
      if (!relToNew.startsWith(".")) {
        relToNew = `./${relToNew}`;
      }
      return `${a}${relToNew}${c}`;
    }
  );
}

/**
 * @param {string} content
 * @param {string} fromRel
 * @param {string} toRel
 */
function rewriteSelfPathLiterals(content, fromRel, toRel) {
  if (!content.includes(fromRel)) {
    return content;
  }
  return content.split(fromRel).join(toRel);
}

/**
 * @param {string} baseRel
 * @param {[string, RegExp][]} rules
 */
function planMoves(baseRel, rules) {
  const baseAbs = join(ROOT, baseRel);
  /** @type {{ from: string, to: string }[]} */
  const moves = [];
  for (const name of readdirSync(baseAbs)) {
    const fromAbs = join(baseAbs, name);
    if (!statSync(fromAbs).isFile()) {
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) || name.endsWith(".d.ts")) {
      continue;
    }
    const bucket = classify(name, rules);
    const toRel = `${baseRel}/${bucket}/${name}`;
    const fromRel = `${baseRel}/${name}`;
    if (fromRel === toRel) {
      continue;
    }
    moves.push({ from: fromRel, to: toRel });
  }
  return moves;
}

function main() {
  /** @type {{ from: string, to: string }[]} */
  const all = [];
  for (const [base, rules] of Object.entries(RULES)) {
    const abs = join(ROOT, base);
    try {
      if (!statSync(abs).isDirectory()) {
        continue;
      }
    } catch {
      continue;
    }
    all.push(...planMoves(base, rules));
  }

  console.log(
    `Planned moves: ${all.length}${APPLY ? " (APPLY)" : " (dry-run)"}`
  );
  const byDest = new Map();
  for (const m of all) {
    const key = m.to.split("/").slice(0, -1).join("/");
    byDest.set(key, (byDest.get(key) ?? 0) + 1);
  }
  for (const [b, n] of [...byDest.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${b}/`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to execute.");
    return;
  }

  /** @type {Map<string, string>} */
  const fromTo = new Map(all.map((m) => [m.from, m.to]));

  for (const m of all) {
    const fromAbs = join(ROOT, m.from);
    const toAbs = join(ROOT, m.to);
    mkdirSync(dirname(toAbs), { recursive: true });
    let content = readFileSync(fromAbs, "utf8");
    content = rewriteRelativeImports(content, fromAbs, toAbs);
    content = rewriteSelfPathLiterals(content, m.from, m.to);
    // sibling fixtures that also move: rewrite old relative path strings
    for (const [oldRel, newRel] of fromTo) {
      if (oldRel === m.from) {
        continue;
      }
      content = rewriteSelfPathLiterals(content, oldRel, newRel);
    }
    writeFileSync(toAbs, content);
    unlinkSync(fromAbs);
    console.log(`  mv ${m.from} → ${m.to}`);
  }

  console.log("Done. Next: node scripts/check-dir-density.mjs");
}

main();
