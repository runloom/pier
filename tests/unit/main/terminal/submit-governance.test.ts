/**
 * 粘贴并提交金标准：只允许 submit-text.ts 在 paste 之后打合成 Return。
 * 禁止产品路径把 `\r` 拼进同一次 sendText。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MAIN_ROOT = join(ROOT, "src", "main");
const SUBMIT_MODULE = "src/main/ipc/terminal/submit-text.ts";

const RETURN_SUBMIT_RE = /APPKIT_KEYCODE\.return|sendKeyPress\([^;]*0x24/u;
const PASTE_TRAILING_CR_RE = /sendText\([^)]*["'][^"']*\\r["']/u;

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) {
      continue;
    }
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkTsFiles(full, out);
    } else if (name.endsWith(".ts") && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("terminal paste-then-submit governance", () => {
  it("locks the gold-standard comment on the single submit primitive", () => {
    const source = readFileSync(join(ROOT, SUBMIT_MODULE), "utf8");
    expect(source).toContain("唯一「粘贴并可提交」入口");
    expect(source).toContain("SUBMIT_ENTER_SETTLE_MS");
  });

  it("only submit-text.ts injects Return as a paste submit", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(MAIN_ROOT)) {
      const rel = relative(ROOT, file);
      if (rel === SUBMIT_MODULE) {
        continue;
      }
      const source = readFileSync(file, "utf8");
      if (RETURN_SUBMIT_RE.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("does not paste trailing \\\\r through sendText in main product code", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(MAIN_ROOT)) {
      const rel = relative(ROOT, file);
      const source = readFileSync(file, "utf8");
      if (PASTE_TRAILING_CR_RE.test(source)) {
        offenders.push(rel);
      }
    }
    expect(offenders).toEqual([]);
  });
});
