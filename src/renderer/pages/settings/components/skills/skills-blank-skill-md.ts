import { skillIdSchema } from "@shared/contracts/project-skills.ts";
import type { Translate } from "./skills-shared.tsx";

/** Local SKILL.md draft used by add dialogs before anything is written. */
export function blankSkillMd(
  skillId: string,
  description: string,
  t: Translate
): string {
  const desc =
    description.trim() || t("settings.skills.blankDefaultDescription");
  const id = skillId.trim() || "skill";
  return `---\nname: ${JSON.stringify(id)}\ndescription: ${JSON.stringify(desc)}\n---\n\n# ${id}\n\n<!-- Describe when and how agents should use this skill. -->\n`;
}

/** Same rules as `skillIdSchema` — keep UI validation aligned with main. */
export function isValidSkillId(skillId: string): boolean {
  return skillIdSchema.safeParse(skillId.trim()).success;
}
