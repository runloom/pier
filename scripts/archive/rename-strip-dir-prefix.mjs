#!/usr/bin/env node
/**
 * Strip redundant parent-directory prefixes from filenames after domain splits.
 *
 * Example:
 *   src/main/services/git/service.ts → src/main/services/git/service.ts
 *   .../review/git-review-document.ts   → .../review/document.ts
 *   .../diff-view/diff-view-items.ts    → .../diff-view/items.ts
 *
 * Dry-run: node scripts/rename-strip-dir-prefix.mjs
 * Apply:   node scripts/rename-strip-dir-prefix.mjs --apply
 */
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");

/**
 * Rules: if repo-relative dir matches `dirMatch`, and basename matches `fileMatch`,
 * rename using `rename(basename) → newBasename`.
 *
 * Order matters (first match wins).
 *
 * @type {{ dirMatch: RegExp, fileMatch: RegExp, rename: (name: string) => string | null, label: string }[]}
 */
const RULES = [
  // --- main services/git ---
  {
    label: "services/git strip git-",
    dirMatch: /(^|\/)src\/main\/services\/git$/,
    fileMatch: /^git-/,
    rename: (n) => n.replace(/^git-/, ""),
  },
  // worktree-* under services/git keeps worktree- (role ≠ folder name "git")

  // --- main services/files ---
  {
    label: "services/files strip file-",
    dirMatch: /(^|\/)src\/main\/services\/files$/,
    fileMatch: /^file-/,
    rename: (n) => n.replace(/^file-/, ""),
  },

  // --- main ipc/terminal ---
  {
    label: "ipc/terminal strip terminal-",
    dirMatch: /(^|\/)src\/main\/ipc\/terminal$/,
    fileMatch: /^terminal-/,
    rename: (n) => n.replace(/^terminal-/, ""),
  },
  {
    label: "ipc/terminal.ts → index.ts",
    dirMatch: /(^|\/)src\/main\/ipc\/terminal$/,
    fileMatch: /^terminal\.ts$/,
    rename: () => "index.ts",
  },

  // --- git-review package ---
  {
    label: "git-review/index strip git-review-index-",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/index$/,
    fileMatch: /^git-review-index-/,
    rename: (n) => n.replace(/^git-review-index-/, ""),
  },
  {
    label: "git-review/index entry",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/index$/,
    fileMatch: /^git-review-index\.ts$/,
    rename: () => "index.ts",
  },
  {
    label: "git-review/document strip git-review-document-",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/document$/,
    fileMatch: /^git-review-document-/,
    rename: (n) => n.replace(/^git-review-document-/, ""),
  },
  {
    label: "git-review/document entry",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/document$/,
    fileMatch: /^git-review-document\.ts$/,
    rename: () => "index.ts",
  },
  {
    label: "git-review/path strip git-review-path",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/path$/,
    fileMatch: /^git-review-path/,
    rename: (n) => {
      const rest = n.replace(/^git-review-path-?/, "");
      if (!rest || rest.startsWith(".")) {
        return rest.startsWith(".") ? `index${rest}` : "index.ts";
      }
      return rest;
    },
  },
  {
    label: "git-review/scheduler strip",
    dirMatch: /(^|\/)src\/main\/services\/git-review\/scheduler$/,
    fileMatch: /^git-review-scheduler/,
    rename: (n) => {
      const rest = n.replace(/^git-review-scheduler-?/, "");
      if (!rest || rest.startsWith(".")) {
        return rest.startsWith(".") ? `index${rest}` : "index.ts";
      }
      return rest;
    },
  },
  {
    label: "git-review root strip git-review-",
    dirMatch: /(^|\/)src\/main\/services\/git-review$/,
    fileMatch: /^git-review-/,
    rename: (n) => n.replace(/^git-review-/, ""),
  },

  // --- project-skills subdirs ---
  {
    label: "project-skills/apply strip apply-",
    dirMatch: /project-skills\/apply$/,
    fileMatch: /^apply-/,
    rename: (n) => n.replace(/^apply-/, ""),
  },
  {
    label: "project-skills/repair strip repair-",
    dirMatch: /project-skills\/repair$/,
    fileMatch: /^repair-/,
    rename: (n) => n.replace(/^repair-/, ""),
  },
  {
    label: "project-skills/import strip import-",
    dirMatch: /project-skills\/import$/,
    fileMatch: /^import-/,
    rename: (n) => n.replace(/^import-/, ""),
  },
  {
    label: "project-skills/store strip store-",
    dirMatch: /project-skills\/store$/,
    fileMatch: /^store-/,
    rename: (n) => n.replace(/^store-/, ""),
  },
  {
    label: "project-skills/store.ts",
    dirMatch: /project-skills\/store$/,
    fileMatch: /^store\.ts$/,
    rename: () => "index.ts",
  },
  {
    label: "project-skills/launch-gate strip",
    dirMatch: /project-skills\/launch-gate$/,
    fileMatch: /^launch-gate-?/,
    rename: (n) => {
      const rest = n.replace(/^launch-gate-?/, "");
      if (rest === ".ts" || rest === "ts" || rest === "") {
        return "index.ts";
      }
      return rest.startsWith(".") ? `index${rest}` : rest;
    },
  },
  {
    label: "project-skills/pier-bindings strip",
    dirMatch: /project-skills\/pier-bindings$/,
    fileMatch: /^pier-bindings-?/,
    rename: (n) => {
      const rest = n.replace(/^pier-bindings-?/, "");
      if (rest === ".ts" || rest === "ts" || rest === "") {
        return "index.ts";
      }
      return rest.startsWith(".") ? `index${rest}` : rest;
    },
  },
  {
    label: "project-skills/system-skills strip",
    dirMatch: /project-skills\/system-skills$/,
    fileMatch: /^system-skills?-?/,
    rename: (n) => {
      const rest = n.replace(/^system-skills?-?/, "");
      if (rest === ".ts" || rest === "ts" || rest === "") {
        return "index.ts";
      }
      return rest.startsWith(".") ? `index${rest}` : rest;
    },
  },

  // --- agents/integrations ---
  {
    label: "integrations/evidence strip evidence-",
    dirMatch: /integrations\/evidence$/,
    fileMatch: /^evidence-/,
    rename: (n) => n.replace(/^evidence-/, ""),
  },
  {
    label: "integrations/hooks strip hook-",
    dirMatch: /integrations\/hooks$/,
    fileMatch: /^hook-/,
    rename: (n) => n.replace(/^hook-/, ""),
  },
  {
    label: "integrations/transcript strip long prefixes",
    dirMatch: /integrations\/transcript$/,
    fileMatch:
      /^(transcript-|claude-transcript-|codex-transcript-|grok-transcript-)/,
    rename: (n) =>
      n
        .replace(/^claude-transcript-/, "claude-")
        .replace(/^codex-transcript-/, "codex-")
        .replace(/^grok-transcript-/, "grok-")
        .replace(/^transcript-/, ""),
  },

  // --- app-core/commands: drop -commands suffix ---
  {
    label: "app-core/commands strip -commands",
    dirMatch: /app-core\/commands$/,
    fileMatch: /-commands\.ts$/,
    rename: (n) => n.replace(/-commands\.ts$/, ".ts"),
  },

  // --- git plugin renderer ---
  {
    label: "git/renderer/review strip git-review-",
    dirMatch: /plugins\/builtin\/git\/renderer\/review$/,
    fileMatch: /^git-review-/,
    rename: (n) => n.replace(/^git-review-/, ""),
  },
  {
    label: "git/renderer/hooks strip use-git-review- → use-",
    dirMatch: /plugins\/builtin\/git\/renderer\/hooks$/,
    fileMatch: /^use-git-review-/,
    rename: (n) => n.replace(/^use-git-review-/, "use-"),
  },
  {
    label: "git/renderer/hooks strip use-git- → use-",
    dirMatch: /plugins\/builtin\/git\/renderer\/hooks$/,
    fileMatch: /^use-git-/,
    rename: (n) => n.replace(/^use-git-/, "use-"),
  },
  {
    label: "git/renderer/worktree strip worktree-",
    dirMatch: /plugins\/builtin\/git\/renderer\/worktree$/,
    fileMatch: /^worktree-/,
    rename: (n) => n.replace(/^worktree-/, ""),
  },

  // --- files plugin renderer ---
  {
    label: "files/editor strip file-editor-",
    dirMatch: /files\/renderer\/editor$/,
    fileMatch: /^file-editor-/,
    rename: (n) => n.replace(/^file-editor-/, ""),
  },
  {
    label: "files/editor strip code-mirror- → cm- keep short",
    dirMatch: /files\/renderer\/editor$/,
    fileMatch: /^code-mirror-/,
    rename: (n) => n.replace(/^code-mirror-/, "cm-"),
  },
  {
    label: "files/tree strip file-tree- / files-tree-",
    dirMatch: /files\/renderer\/tree$/,
    fileMatch: /^(file-tree-|files-tree-)/,
    rename: (n) => n.replace(/^(file-tree-|files-tree-)/, ""),
  },
  {
    label: "files/document strip file(s)-document-",
    dirMatch: /files\/renderer\/document$/,
    fileMatch: /^(file-document-|files-document-|files-draft)/,
    rename: (n) =>
      n
        .replace(/^file-document-/, "")
        .replace(/^files-document-/, "")
        .replace(/^files-draft-/, "draft-")
        .replace(/^files-drafts/, "drafts"),
  },
  {
    label: "files/panel strip file(s)-panel-",
    dirMatch: /files\/renderer\/panel$/,
    fileMatch: /^(file-panel-|files-panel-|files-group-)/,
    rename: (n) =>
      n
        .replace(/^file-panel-/, "")
        .replace(/^files-panel-/, "")
        .replace(/^files-group-/, "group-")
        .replace(/^file-panel\./, "panel.")
        .replace(/^files-panel\./, "panel."),
  },
  {
    label: "files/panel file-panel.tsx",
    dirMatch: /files\/renderer\/panel$/,
    fileMatch: /^file-panel\.(tsx|ts)$/,
    rename: (n) => n.replace(/^file-panel\./, "panel."),
  },
  {
    label: "files/search strip files-content-search-",
    dirMatch: /files\/renderer\/search$/,
    fileMatch: /^files-content-search-/,
    rename: (n) => n.replace(/^files-content-search-/, ""),
  },
  {
    label: "files/markdown strip markdown-",
    dirMatch: /files\/renderer\/markdown$/,
    fileMatch: /^markdown-/,
    rename: (n) => n.replace(/^markdown-/, ""),
  },

  // --- packages/ui ---
  {
    label: "ui/diff-view strip diff-view-",
    dirMatch: /packages\/ui\/src\/diff-view$/,
    fileMatch: /^diff-view-/,
    rename: (n) => n.replace(/^diff-view-/, ""),
  },
  {
    label: "ui/diff-view.tsx → index.tsx",
    dirMatch: /packages\/ui\/src\/diff-view$/,
    fileMatch: /^diff-view\.(tsx|ts)$/,
    rename: (n) => n.replace(/^diff-view\./, "index."),
  },
  {
    label: "ui/diff-view use-diff-view- → use-",
    dirMatch: /packages\/ui\/src\/diff-view$/,
    fileMatch: /^use-diff-view-/,
    rename: (n) => n.replace(/^use-diff-view-/, "use-"),
  },
  {
    label: "ui/file strip file-",
    dirMatch: /packages\/ui\/src\/file$/,
    fileMatch: /^file-/,
    rename: (n) => n.replace(/^file-/, ""),
  },

  // --- renderer lib/plugins ---
  {
    label: "lib/plugins/host strip host-",
    dirMatch: /lib\/plugins\/host$/,
    fileMatch: /^host-/,
    rename: (n) => n.replace(/^host-/, ""),
  },
  {
    label: "lib/plugins/lifecycle strip plugin-lifecycle-",
    dirMatch: /lib\/plugins\/lifecycle$/,
    fileMatch: /^plugin-lifecycle-/,
    rename: (n) => n.replace(/^plugin-lifecycle-/, ""),
  },
  {
    label: "lib/plugins/runtime strip runtime-",
    dirMatch: /lib\/plugins\/runtime$/,
    fileMatch: /^runtime-/,
    rename: (n) => n.replace(/^runtime-/, ""),
  },
  {
    label: "lib/plugins/runtime.ts",
    dirMatch: /lib\/plugins\/runtime$/,
    fileMatch: /^runtime\.ts$/,
    rename: () => "index.ts",
  },
  {
    label: "lib/plugins/external strip external-",
    dirMatch: /lib\/plugins\/external$/,
    fileMatch: /^external-/,
    rename: (n) => n.replace(/^external-/, ""),
  },
  {
    label: "lib/plugins/mermaid strip mermaid-",
    dirMatch: /lib\/plugins\/mermaid$/,
    fileMatch: /^mermaid-/,
    rename: (n) => n.replace(/^mermaid-/, ""),
  },

  // --- shared contracts ---
  {
    label: "contracts/terminal strip terminal-",
    dirMatch: /shared\/contracts\/terminal$/,
    fileMatch: /^terminal-/,
    rename: (n) => n.replace(/^terminal-/, ""),
  },
  {
    label: "contracts/file strip file-/files-",
    dirMatch: /shared\/contracts\/file$/,
    fileMatch: /^(file-|files-)/,
    rename: (n) => n.replace(/^(file-|files-)/, ""),
  },
  {
    label: "contracts/agent strip agent-",
    dirMatch: /shared\/contracts\/agent$/,
    fileMatch: /^agent-/,
    rename: (n) => n.replace(/^agent-/, ""),
  },
  {
    label: "contracts/git strip git-/worktree-",
    dirMatch: /shared\/contracts\/git$/,
    fileMatch: /^(git-|worktree-)/,
    rename: (n) =>
      n.replace(/^(git-|worktree-)/, (m) =>
        m === "worktree-" ? "worktree-" : ""
      ),
  },
  {
    label: "contracts/plugin strip plugin-/managed-plugin",
    dirMatch: /shared\/contracts\/plugin$/,
    fileMatch: /^(plugin-|managed-plugin)/,
    rename: (n) =>
      n.replace(/^plugin-/, "").replace(/^managed-plugin/, "managed"),
  },

  // --- terminal panel-kit ---
  {
    label: "panel-kits/terminal strip terminal-",
    dirMatch: /panel-kits\/terminal$/,
    fileMatch: /^terminal-/,
    rename: (n) => n.replace(/^terminal-/, ""),
  },
  {
    label: "panel-kits/terminal/hooks use-terminal- → use-",
    dirMatch: /panel-kits\/terminal\/hooks$/,
    fileMatch: /^use-terminal-/,
    rename: (n) => n.replace(/^use-terminal-/, "use-"),
  },

  // --- workspace transfer ---
  {
    label: "workspace/transfer strip panel-transfer-",
    dirMatch: /components\/workspace\/transfer$/,
    fileMatch: /^panel-transfer-/,
    rename: (n) => n.replace(/^panel-transfer-/, ""),
  },
  {
    label: "workspace/transfer strip workspace-panel-transfer-",
    dirMatch: /components\/workspace\/transfer$/,
    fileMatch: /^workspace-panel-transfer-/,
    rename: (n) => n.replace(/^workspace-panel-transfer-/, ""),
  },
  {
    label: "workspace/transfer workspace-panel-transfer.ts",
    dirMatch: /components\/workspace\/transfer$/,
    fileMatch: /^workspace-panel-transfer\./,
    rename: (n) => n.replace(/^workspace-panel-transfer\./, "index."),
  },
  {
    label: "workspace/transfer attach-workspace-panel-transfer",
    dirMatch: /components\/workspace\/transfer$/,
    fileMatch: /^attach-workspace-panel-transfer/,
    rename: (n) => n.replace(/^attach-workspace-panel-transfer/, "attach"),
  },

  // --- common clusters ---
  {
    label: "common/dialogs strip app- prefixes lightly",
    dirMatch: /components\/common\/dialogs$/,
    fileMatch:
      /^(app-content-dialog-|app-dialog-|content-dialog-|use-content-dialog-)/,
    rename: (n) =>
      n
        .replace(/^app-content-dialog-/, "content-")
        .replace(/^app-dialog-/, "")
        .replace(/^content-dialog-/, "")
        .replace(/^use-content-dialog-/, "use-"),
  },
  {
    label: "common/dialogs hosts",
    dirMatch: /components\/common\/dialogs$/,
    fileMatch: /^(app-dialog-host|app-content-dialog-host)\./,
    rename: (n) =>
      n
        .replace(/^app-dialog-host\./, "host.")
        .replace(/^app-content-dialog-host\./, "content-host."),
  },
  {
    label: "common/notifications strip notification-",
    dirMatch: /components\/common\/notifications$/,
    fileMatch: /^notification-/,
    rename: (n) => n.replace(/^notification-/, ""),
  },
  {
    label: "common/command-palette strip command-palette-",
    dirMatch: /components\/common\/command-palette$/,
    fileMatch: /^command-palette-/,
    rename: (n) => n.replace(/^command-palette-/, ""),
  },
  {
    label: "common/command-palette.tsx",
    dirMatch: /components\/common\/command-palette$/,
    fileMatch: /^command-palette\./,
    rename: (n) => n.replace(/^command-palette\./, "index."),
  },
  {
    label: "common/terminal-debug strip terminal-debug-",
    dirMatch: /components\/common\/terminal-debug$/,
    fileMatch: /^terminal-debug-/,
    rename: (n) => n.replace(/^terminal-debug-/, ""),
  },

  // --- tests mirroring source domains ---
  {
    label: "tests git/review strip git-review-",
    dirMatch: /tests\/.*\/git\/review$/,
    fileMatch: /^git-review-/,
    rename: (n) => n.replace(/^git-review-/, ""),
  },
  {
    label: "tests unit main/git strip git-",
    dirMatch: /tests\/unit\/main\/git$/,
    fileMatch: /^git-/,
    rename: (n) => n.replace(/^git-/, ""),
  },
  {
    label: "tests unit main/terminal strip terminal-",
    dirMatch: /tests\/unit\/main\/terminal$/,
    fileMatch: /^terminal-/,
    rename: (n) => n.replace(/^terminal-/, ""),
  },
  {
    label: "tests unit renderer/terminal strip terminal-",
    dirMatch: /tests\/unit\/renderer\/terminal$/,
    fileMatch: /^terminal-/,
    rename: (n) => n.replace(/^terminal-/, ""),
  },
  {
    label: "tests unit main/files strip file-",
    dirMatch: /tests\/unit\/main\/files$/,
    fileMatch: /^file-/,
    rename: (n) => n.replace(/^file-/, ""),
  },
  {
    label: "tests unit main/project-skills strip project-skills-",
    dirMatch: /tests\/unit\/main\/project-skills$/,
    fileMatch: /^project-skills-/,
    rename: (n) => n.replace(/^project-skills-/, ""),
  },
  {
    label: "tests unit main/lsp strip lsp-",
    dirMatch: /tests\/unit\/main\/lsp$/,
    fileMatch: /^lsp-/,
    rename: (n) => n.replace(/^lsp-/, ""),
  },
  {
    label: "tests unit renderer/files/editor strip file-editor-",
    dirMatch: /tests\/unit\/renderer\/files\/editor$/,
    fileMatch: /^file-editor-/,
    rename: (n) => n.replace(/^file-editor-/, ""),
  },
  {
    label: "tests unit renderer/files/editor files-editor-",
    dirMatch: /tests\/unit\/renderer\/files\/editor$/,
    fileMatch: /^files-editor-/,
    rename: (n) => n.replace(/^files-editor-/, ""),
  },
  {
    label: "tests unit renderer/files/tree strip",
    dirMatch: /tests\/unit\/renderer\/files\/tree$/,
    fileMatch: /^(file-tree-|files-tree-)/,
    rename: (n) => n.replace(/^(file-tree-|files-tree-)/, ""),
  },
  {
    label: "tests unit renderer/files/lsp strip files-lsp-",
    dirMatch: /tests\/unit\/renderer\/files\/lsp$/,
    fileMatch: /^(files-lsp-|file-lsp-)/,
    rename: (n) => n.replace(/^(files-lsp-|file-lsp-)/, ""),
  },
  {
    label: "tests unit renderer/files/search strip",
    dirMatch: /tests\/unit\/renderer\/files\/search$/,
    fileMatch:
      /^(files-content-search-|files-search-|files-path-query-|files-quick-open-)/,
    rename: (n) =>
      n
        .replace(/^files-content-search-/, "")
        .replace(/^files-search-/, "")
        .replace(/^files-path-query-/, "path-query-")
        .replace(/^files-quick-open-/, "quick-open-"),
  },
  {
    label: "tests unit renderer/files strip files-",
    dirMatch: /tests\/unit\/renderer\/files$/,
    fileMatch: /^files-/,
    rename: (n) => n.replace(/^files-/, ""),
  },
  {
    label: "tests e2e strip domain prefixes",
    dirMatch: /tests\/e2e\/(terminal|git|files|lsp|workbench)$/,
    fileMatch: /^(terminal-|git-|files-|lsp-|workbench-)/,
    rename: (n) => n.replace(/^(terminal-|git-|files-|lsp-|workbench-)/, ""),
  },
  {
    label: "tests component workbench strip",
    dirMatch: /tests\/component\/workbench$/,
    fileMatch: /^workbench-/,
    rename: (n) => n.replace(/^workbench-/, ""),
  },
  {
    label:
      "tests unit main/agents/* strip agent name prefix when folder is agent",
    dirMatch: /tests\/unit\/main\/agents\/(claude|codex|grok)$/,
    fileMatch: /^(claude-|codex-|grok-)/,
    rename: (n) => n.replace(/^(claude-|codex-|grok-)/, ""),
  },
  {
    label: "settings/skills strip skills-",
    dirMatch: /settings\/components\/skills$/,
    fileMatch: /^skills-/,
    rename: (n) => n.replace(/^skills-/, ""),
  },
  {
    label: "panel-kits/workbench strip workbench-",
    dirMatch: /panel-kits\/workbench$/,
    fileMatch: /^workbench-/,
    rename: (n) =>
      n.replace(/^worktree-/, "worktree-").replace(/^workbench-/, ""),
  },
  {
    label: "main/services/lsp strip lsp-",
    dirMatch: /services\/lsp$/,
    fileMatch: /^lsp-/,
    rename: (n) => n.replace(/^lsp-/, ""),
  },
  {
    label: "main/services/panel-transfer strip panel-transfer-",
    dirMatch: /services\/panel-transfer$/,
    fileMatch: /^panel-transfer-/,
    rename: (n) => n.replace(/^panel-transfer-/, ""),
  },

  // --- packages/ui file hooks (after move into file/) ---
  {
    label: "files/renderer use-file-panel- → use-panel-",
    dirMatch: /files\/renderer$/,
    fileMatch: /^use-file-panel-/,
    rename: (n) => n.replace(/^use-file-panel-/, "use-panel-"),
  },
  {
    label: "tests files strip file-/use-files-",
    dirMatch: /tests\/unit\/renderer\/files$/,
    fileMatch: /^(file-|use-files-)/,
    rename: (n) => n.replace(/^file-/, "").replace(/^use-files-/, "use-"),
  },
  {
    label: "ui/file use-file-tree- → use-tree-",
    dirMatch: /packages\/ui\/src\/file$/,
    fileMatch: /^use-file-tree-/,
    rename: (n) => n.replace(/^use-file-tree-/, "use-tree-"),
  },
  {
    label: "ui/image-preview strip image-preview-",
    dirMatch: /packages\/ui\/src\/image-preview$/,
    fileMatch: /^image-preview-/,
    rename: (n) => n.replace(/^image-preview-/, ""),
  },
  {
    label: "app-updates strip app-update-",
    dirMatch: /services\/app-updates$/,
    fileMatch: /^app-update-/,
    rename: (n) => n.replace(/^app-update-/, ""),
  },
  {
    label: "live-modules strip live-module-",
    dirMatch: /(^|\/)src\/main\/live-modules$/,
    fileMatch: /^live-module-/,
    rename: (n) => n.replace(/^live-module-/, ""),
  },
  {
    label: "agent-runtime strip agent-index-",
    dirMatch: /lib\/agent-runtime$/,
    fileMatch: /^agent-index-/,
    rename: (n) => n.replace(/^agent-index-/, "index-"),
  },
  {
    label: "agent-status strip agent-",
    dirMatch: /components\/agent-status$/,
    fileMatch: /^agent-/,
    rename: (n) => n.replace(/^agent-/, ""),
  },
  {
    label: "menu strip menu-",
    dirMatch: /(^|\/)src\/main\/menu$/,
    fileMatch: /^menu-/,
    rename: (n) => n.replace(/^menu-/, ""),
  },
  {
    label: "account-usage strip account-",
    dirMatch: /account-usage$/,
    fileMatch: /^account-/,
    rename: (n) => n.replace(/^account-/, ""),
  },
  {
    label: "app-core strip app-relaunch/update-wiring",
    dirMatch: /app-core$/,
    fileMatch: /^(app-relaunch|app-update-wiring)\./,
    rename: (n) =>
      n
        .replace(/^app-relaunch\./, "relaunch.")
        .replace(/^app-update-wiring\./, "update-wiring."),
  },
  {
    label: "tests settings strip settings-",
    dirMatch: /tests\/.*\/settings$/,
    fileMatch: /^settings-/,
    rename: (n) => n.replace(/^settings-/, ""),
  },
  {
    label: "tests app-core strip app-",
    dirMatch: /tests\/unit\/main\/app-core$/,
    fileMatch: /^app-/,
    rename: (n) => n.replace(/^app-/, ""),
  },
  {
    label: "tests renderer/app strip app-",
    dirMatch: /tests\/(unit\/renderer|component)\/app$/,
    fileMatch: /^app-/,
    rename: (n) => n.replace(/^app-/, ""),
  },
  {
    label: "tests files/panel strip files-",
    dirMatch: /tests\/.*\/files\/panel$/,
    fileMatch: /^files-/,
    rename: (n) => n.replace(/^files-/, ""),
  },
  {
    label: "tests files/document strip files-(document-)?",
    dirMatch: /tests\/.*\/files\/document$/,
    fileMatch: /^files-/,
    rename: (n) => n.replace(/^files-document-/, "").replace(/^files-/, ""),
  },

  {
    label: "components/workspace strip workspace-",
    dirMatch: /components\/workspace$/,
    fileMatch: /^workspace-/,
    rename: (n) => n.replace(/^workspace-/, ""),
  },
];

/**
 * @returns {{ from: string, to: string, label: string }[]}
 */
function planRenames() {
  /** @type {{ from: string, to: string, label: string }[]} */
  const planned = [];
  /** @type {Set<string>} */
  const targets = new Set();
  /** @type {Set<string>} */
  const sources = new Set();

  const roots = ["src", "packages", "tests"];
  for (const root of roots) {
    walk(join(ROOT, root), (dirAbs, names) => {
      const dirRel = relative(ROOT, dirAbs).split(sep).join("/");
      for (const name of names) {
        if (
          !/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(name) ||
          name.endsWith(".d.ts")
        ) {
          continue;
        }
        for (const rule of RULES) {
          if (!rule.dirMatch.test(dirRel)) {
            continue;
          }
          if (!rule.fileMatch.test(name)) {
            continue;
          }
          const next = rule.rename(name);
          if (!next || next === name) {
            continue;
          }
          // sanitize empty / invalid
          if (!/^[\w.-]+\.(ts|tsx|js|jsx|mjs|cjs)$/.test(next)) {
            console.warn(
              `skip invalid rename ${dirRel}/${name} → ${next} (${rule.label})`
            );
            continue;
          }
          const from = `${dirRel}/${name}`;
          const to = `${dirRel}/${next}`;
          if (sources.has(from) || targets.has(to) || sources.has(to)) {
            console.warn(`skip collision ${from} → ${to}`);
            continue;
          }
          // existing file at destination?
          if (existsSync(join(ROOT, to)) && from !== to) {
            console.warn(`skip exists ${from} → ${to}`);
            continue;
          }
          sources.add(from);
          targets.add(to);
          planned.push({ from, to, label: rule.label });
          break;
        }
      }
    });
  }
  return planned;
}

/**
 * @param {string} abs
 * @param {(dirAbs: string, files: string[]) => void} visit
 */
function walk(abs, visit) {
  if (!existsSync(abs)) {
    return;
  }
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  const files = [];
  for (const ent of entries) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    const child = join(abs, ent.name);
    if (ent.isDirectory()) {
      if (
        ent.name === "node_modules" ||
        ent.name === "dist" ||
        ent.name === "dist-package" ||
        ent.name === "dist-pkg"
      ) {
        continue;
      }
      walk(child, visit);
    } else if (ent.isFile()) {
      files.push(ent.name);
    }
  }
  if (files.length > 0) {
    visit(abs, files);
  }
}

/**
 * @param {string} rel
 */
function aliasForms(rel) {
  /** @type {string[]} */
  const forms = [rel];
  if (rel.startsWith("src/main/")) {
    forms.push(`@main/${rel.slice("src/main/".length)}`);
  }
  if (rel.startsWith("src/shared/")) {
    forms.push(`@shared/${rel.slice("src/shared/".length)}`);
  }
  if (rel.startsWith("src/plugins/")) {
    forms.push(`@plugins/${rel.slice("src/plugins/".length)}`);
  }
  if (rel.startsWith("src/preload/")) {
    forms.push(`@preload/${rel.slice("src/preload/".length)}`);
  }
  if (rel.startsWith("src/renderer/")) {
    forms.push(`@/${rel.slice("src/renderer/".length)}`);
  }
  if (rel.startsWith("packages/ui/src/")) {
    forms.push(`@pier/ui/${rel.slice("packages/ui/src/".length)}`);
  }
  return forms;
}

/**
 * @param {Map<string, string>} fromTo
 */
function buildReplacementMap(fromTo) {
  /** @type {Map<string, string>} */
  const map = new Map();
  for (const [fromRel, toRel] of fromTo) {
    const fromA = aliasForms(fromRel);
    const toA = aliasForms(toRel);
    for (let i = 0; i < fromA.length; i += 1) {
      map.set(fromA[i], toA[i] ?? toRel);
    }
  }
  return map;
}

function listRewriteTargets() {
  /** @type {string[]} */
  const files = [];
  for (const root of ["src", "packages", "tests", "scripts"]) {
    walkFiles(join(ROOT, root), files);
  }
  return files;
}

/**
 * @param {string} abs
 * @param {string[]} out
 */
function walkFiles(abs, out) {
  if (!existsSync(abs)) {
    return;
  }
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name.startsWith(".")) {
      continue;
    }
    const child = join(abs, ent.name);
    if (ent.isDirectory()) {
      if (
        [
          "node_modules",
          "dist",
          "dist-package",
          "dist-pkg",
          "out",
          "coverage",
        ].includes(ent.name)
      ) {
        continue;
      }
      walkFiles(child, out);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|md|json)$/.test(ent.name)) {
      out.push(child);
    }
  }
}

/**
 * @param {string} content
 * @param {string} fileAbs
 * @param {Map<string, string>} fromTo
 * @param {Map<string, string>} replacementMap
 */
function rewriteContent(content, fileAbs, fromTo, replacementMap) {
  let next = content;
  const keys = [...replacementMap.keys()].sort((a, b) => b.length - a.length);
  for (const from of keys) {
    const to = replacementMap.get(from);
    if (!(to && next.includes(from))) {
      continue;
    }
    next = next.split(from).join(to);
  }

  // relative imports
  next = next.replace(
    /(from\s+['"])(\.\.[^'"]+|\.\/[^'"]+)(['"])/g,
    (full, a, spec, c) => {
      const resolved = normalize(join(dirname(fileAbs), spec));
      const relPosix = relative(ROOT, resolved).split(sep).join("/");
      for (const cand of expand(relPosix)) {
        const dest = fromTo.get(cand);
        if (dest) {
          let relToNew = relative(dirname(fileAbs), join(ROOT, dest))
            .split(sep)
            .join("/");
          if (!relToNew.startsWith(".")) {
            relToNew = `./${relToNew}`;
          }
          return `${a}${relToNew}${c}`;
        }
      }
      return full;
    }
  );
  return next;
}

/** @param {string} p */
function normalize(p) {
  const parts = p.split(sep);
  /** @type {string[]} */
  const stack = [];
  for (const part of parts) {
    if (part === "..") {
      stack.pop();
    } else if (part !== ".") {
      stack.push(part);
    }
  }
  return stack.join(sep);
}

/** @param {string} rel */
function expand(rel) {
  const out = new Set([rel]);
  if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(rel)) {
    for (const ext of [".ts", ".tsx", ".js", ".jsx", ".mjs"]) {
      out.add(rel + ext);
    }
  }
  return out;
}

function main() {
  const planned = planRenames();
  console.log(
    `Planned renames: ${planned.length}${APPLY ? " (APPLY)" : " (dry-run)"}`
  );
  const byLabel = new Map();
  for (const p of planned) {
    byLabel.set(p.label, (byLabel.get(p.label) ?? 0) + 1);
  }
  for (const [label, n] of [...byLabel.entries()].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${label}`);
  }
  // show samples
  console.log("\nSamples:");
  for (const p of planned.slice(0, 25)) {
    console.log(`  ${p.from.split("/").pop()} → ${p.to.split("/").pop()}`);
  }
  if (planned.length > 25) {
    console.log(`  ... +${planned.length - 25} more`);
  }

  if (!APPLY) {
    console.log("\nRe-run with --apply to execute.");
    return;
  }

  const fromTo = new Map(planned.map((p) => [p.from, p.to]));
  const replacementMap = buildReplacementMap(fromTo);

  // rename files (two-phase to avoid clobber on swap)
  for (const p of planned) {
    const fromAbs = join(ROOT, p.from);
    const toAbs = join(ROOT, p.to);
    mkdirSync(dirname(toAbs), { recursive: true });
    renameSync(fromAbs, toAbs);
    console.log(`  rn ${p.from} → ${p.to}`);
  }

  const targets = listRewriteTargets();
  let rewritten = 0;
  for (const abs of targets) {
    const before = readFileSync(abs, "utf8");
    const after = rewriteContent(before, abs, fromTo, replacementMap);
    if (after !== before) {
      writeFileSync(abs, after);
      rewritten += 1;
    }
  }
  console.log(`Rewrote references in ${rewritten} files.`);
  console.log("Done. Next: node scripts/check-dir-density.mjs");
}

main();
