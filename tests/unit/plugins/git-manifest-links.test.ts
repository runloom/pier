import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { GIT_PLUGIN_MANIFEST } from "@plugins/builtin/git/manifest.ts";
import { pluginLocaleMessagesSchema } from "@shared/contracts/plugin.ts";
import { describe, expect, it } from "vitest";

const LOCALES_DIR = join(process.cwd(), "src/plugins/builtin/git/locales");
const LOCALE_FILES = ["en.json", "zh-CN.json"];

describe("git plugin manifest links and locale categories", () => {
  it("declares https homepage and repository", () => {
    expect(GIT_PLUGIN_MANIFEST.homepage).toBe(
      "https://github.com/runloom/pier"
    );
    expect(GIT_PLUGIN_MANIFEST.repository).toBe(
      "https://github.com/runloom/pier"
    );
  });

  it("localizes a category for every manifest command in every locale", async () => {
    for (const file of LOCALE_FILES) {
      const raw: unknown = JSON.parse(
        await readFile(join(LOCALES_DIR, file), "utf8")
      );
      const messages = pluginLocaleMessagesSchema.parse(raw);
      for (const command of GIT_PLUGIN_MANIFEST.commands) {
        expect(
          messages.commands?.[command.id]?.category,
          `${file} is missing category for ${command.id}`
        ).toBeTruthy();
      }
    }
  });
});
