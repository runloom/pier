import { createHash } from "node:crypto";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import {
  AGENTS_MD_TEMPLATE,
  type AgentRulesService,
} from "../agent-rules/service.ts";
import type { MemoryLedger } from "./ledger.ts";
import type { ProjectRoot, TargetRow } from "./types.ts";

export const SECTION_BEGIN = "<!-- pier-managed:memory begin -->";
export const SECTION_END = "<!-- pier-managed:memory end -->";

/** 必须与 resources/memory-launcher/memory-mcp.mjs 的 MEMORY_INSTRUCTIONS 字节相等。 */
export const GUIDANCE_BODY = [
  "# Project memory (managed by Pier)",
  "",
  'You have persistent project memory tools from the "pier-memory" MCP server.',
  "Use them to make future sessions in this repository more effective:",
  "",
  "- Before starting a non-trivial task, call search_nodes with keywords of the task domain.",
  "- When you learn a durable fact, record it as an observation on the matching entity",
  "  (create the entity when absent). entityType MUST be one of:",
  "  convention | pitfall | decision | environment.",
  "- Do NOT record anything derivable from the codebase (file layout, dependency lists,",
  "  command --help output), transient task state, or secrets/tokens.",
  "- When you notice an observation is outdated, delete it (delete_observations).",
  "  This store has no automatic decay; pruning is your responsibility.",
  "- Keep observations atomic: one fact per observation, self-contained wording.",
].join("\n");

export const SECTION_TEXT = `${SECTION_BEGIN}\n${GUIDANCE_BODY}\n${SECTION_END}`;

const AGENTS_REF = "@AGENTS.md";

function sha(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function upsertSection(
  content: string,
  sectionText: string
): { changed: boolean; content: string } {
  const begin = content.indexOf(SECTION_BEGIN);
  const end = content.indexOf(SECTION_END);
  if (begin >= 0 && end >= 0) {
    const next = `${content.slice(0, begin)}${sectionText}${content.slice(end + SECTION_END.length)}`;
    return { changed: next !== content, content: next };
  }
  const base =
    content.endsWith("\n") || content === "" ? content : `${content}\n`;
  return { changed: true, content: `${base}\n${sectionText}\n` };
}

export function removeSection(content: string): string {
  const begin = content.indexOf(SECTION_BEGIN);
  const end = content.indexOf(SECTION_END);
  if (begin < 0 || end < 0) {
    return content;
  }
  return `${content.slice(0, begin)}${content.slice(end + SECTION_END.length)}`.replace(
    /\n{3,}/g,
    "\n\n"
  );
}

export async function applyGuidance(args: {
  agentRules: AgentRulesService;
  desired: "enabled" | "disabled";
  ledger: MemoryLedger;
  root: ProjectRoot;
}): Promise<TargetRow> {
  const { agentRules, desired, ledger, root } = args;
  const ref = {
    projectRootPath: root.projectRootPath,
    scope: "project",
  } as const;
  const configPath = join(root.projectRootPath, "AGENTS.md");
  if (desired === "enabled") {
    const existed = await agentRules
      .read(ref, "agents-md")
      .then(() => true)
      .catch(() => false);
    await agentRules.ensure(ref, "agents-md");
    const read = await agentRules.read(ref, "agents-md");
    const updated = upsertSection(read.content, SECTION_TEXT);
    if (updated.changed) {
      await agentRules.write(ref, "agents-md", updated.content);
    }
    ledger.rulesSection = {
      agentsMdExistedBefore: ledger.rulesSection.inserted
        ? ledger.rulesSection.agentsMdExistedBefore
        : existed,
      fingerprint: sha(SECTION_TEXT),
      inserted: true,
    };
    const claude = await agentRules
      .read(ref, "claude-md")
      .then((result) => result.content)
      .catch(() => null);
    if (claude !== null && !/^@AGENTS\.md\s*$/m.test(claude)) {
      const lines = claude.split("\n");
      lines.splice(1, 0, AGENTS_REF);
      await agentRules.write(ref, "claude-md", lines.join("\n"));
      ledger.claudeReference = { insertedByPier: true, present: true };
    } else if (claude !== null) {
      ledger.claudeReference = {
        insertedByPier: ledger.claudeReference.insertedByPier,
        present: true,
      };
    }
    return { configPath, consumers: [], outcome: "written" };
  }
  const read = await agentRules.read(ref, "agents-md").catch(() => null);
  if (read !== null) {
    const stripped = removeSection(read.content);
    const isSelfCreated =
      ledger.rulesSection.agentsMdExistedBefore === false &&
      stripped.trim() === AGENTS_MD_TEMPLATE.trim();
    if (isSelfCreated) {
      await unlink(configPath);
    } else {
      await agentRules.write(ref, "agents-md", stripped);
    }
    ledger.rulesSection = {
      agentsMdExistedBefore: ledger.rulesSection.agentsMdExistedBefore,
      fingerprint: "",
      inserted: false,
    };
  }
  if (ledger.claudeReference.present && ledger.claudeReference.insertedByPier) {
    const claude = await agentRules
      .read(ref, "claude-md")
      .then((result) => result.content)
      .catch(() => null);
    if (claude !== null) {
      await agentRules.write(
        ref,
        "claude-md",
        claude.replace(/^@AGENTS\.md\n/m, "")
      );
    }
    ledger.claudeReference = { insertedByPier: false, present: false };
  }
  return { configPath, consumers: [], outcome: "removed" };
}
