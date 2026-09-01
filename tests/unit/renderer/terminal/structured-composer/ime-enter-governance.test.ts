import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const COMPOSER_DIR = join(
  process.cwd(),
  "src/renderer/panel-kits/terminal/structured-composer"
);

const ENTER_PLUGINS = [
  "enter-key-plugin.tsx",
  "mention-plugin.tsx",
  "skill-suggest-plugin.tsx",
  "attachment-autocomplete-plugin.tsx",
] as const;

describe("composer IME Enter handlers", () => {
  it("checks IME pending before preventDefault on KEY_ENTER_COMMAND", () => {
    for (const fileName of ENTER_PLUGINS) {
      const source = readFileSync(join(COMPOSER_DIR, fileName), "utf8");
      const enterStart = source.indexOf("KEY_ENTER_COMMAND");
      expect(enterStart, fileName).toBeGreaterThan(-1);
      const handler = source.slice(enterStart, enterStart + 700);
      const ime = handler.indexOf("shouldDeferImeEnter");
      expect(ime, `${fileName} IME check`).toBeGreaterThan(-1);
      const prevent = handler.indexOf("preventDefault");
      if (prevent !== -1) {
        expect(ime, `${fileName} IME before preventDefault`).toBeLessThan(
          prevent
        );
      }
    }
  });

  it("EnterKeyPlugin consumes IME Enter without preventDefault", () => {
    const source = readFileSync(
      join(COMPOSER_DIR, "enter-key-plugin.tsx"),
      "utf8"
    );
    expect(source).toMatch(
      /if \(shouldDeferImeEnter\(event, isImeHeld\)\) \{\s*return true;/u
    );
  });
});
