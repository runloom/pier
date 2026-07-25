import { describe, expect, it } from "vitest";
import {
  replaceSkillMdDescription,
  replaceSkillMdName,
} from "@/pages/settings/components/skills/skills-skill-md-description.ts";

describe("skill md frontmatter helpers", () => {
  it("updates a quoted description in frontmatter", () => {
    const source = `---
name: new-skill
description: "说明此技能适用于什么场景。"
---

# new-skill
`;
    const next = replaceSkillMdDescription(source, "Review pull requests");
    expect(next).toContain('description: "Review pull requests"');
    expect(next).toContain("name: new-skill");
  });

  it("updates the name in frontmatter as a quoted string and syncs the heading", () => {
    const source = `---
name: new-skill
description: "Describe when agents should use this skill."
---

# new-skill
`;
    const next = replaceSkillMdName(source, "review-guide");
    expect(next).toContain('name: "review-guide"');
    expect(next).toContain("# review-guide");
    expect(next).toContain(
      'description: "Describe when agents should use this skill."'
    );
  });

  it("quotes numeric skill ids so YAML keeps them as strings", () => {
    const source = `---
name: "skill"
description: "Describe when agents should use this skill."
---

# skill
`;
    const next = replaceSkillMdName(source, "333");
    expect(next).toContain('name: "333"');
    expect(next).toContain("# 333");
  });
});
