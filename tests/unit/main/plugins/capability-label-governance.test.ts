// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import { describe, expect, it } from "vitest";

/**
 * 权限透明度契约（插件机制路线图 Phase 1.3）：
 *
 * 1. 枚举里每个 PierCapability 必须有四语言的人话标签 ——
 *    用户在设置页能看到"这个插件能干什么"，新增能力漏配文案直接 CI 红。
 * 2. 标签文件必须被 settings-plugins 以 permissionLabels 挂载（防断线）。
 */

const LOCALES = ["en", "zh-CN", "ja", "ko"] as const;
const REPO_ROOT = join(process.cwd());

function parseLabels(locale: string): Map<string, string> {
  const path = join(
    REPO_ROOT,
    "src/renderer/i18n/locales",
    locale,
    "plugin-permissions.ts"
  );
  const text = readFileSync(path, "utf-8");
  const map = new Map<string, string>();
  for (const match of text.matchAll(
    /"?([a-zA-Z]+(?:-[a-zA-Z]+)*:[a-zA-Z]+|[a-z]+)"?\s*:\s*"([^"]*)"/gu
  )) {
    const key = match[1];
    if (
      key !== undefined &&
      pierCapabilitySchema.options.includes(key as never)
    ) {
      map.set(key, match[2] ?? "");
    }
  }
  return map;
}

describe("permission label transparency contract", () => {
  it("covers every PierCapability in all four locales with a non-empty human-readable label", () => {
    const capabilities = pierCapabilitySchema.options;
    expect(capabilities.length).toBeGreaterThan(30);

    for (const locale of LOCALES) {
      const labels = parseLabels(locale);
      const missing = capabilities.filter(
        (capability) =>
          !labels.has(capability) || (labels.get(capability) ?? "").length === 0
      );
      expect(
        missing,
        `${locale} 缺少 capability 人话标签: ${missing.join(", ")}`
      ).toEqual([]);
      // 标签必须是可读文案，不允许原样回填 capability 代码。
      for (const capability of capabilities) {
        const label = labels.get(capability);
        expect(label).toBeTruthy();
        expect(label).not.toBe(capability);
      }
    }
  });

  it("mounts the labels map under settings.plugins.permissionLabels in every locale", () => {
    for (const locale of LOCALES) {
      const text = readFileSync(
        join(
          REPO_ROOT,
          "src/renderer/i18n/locales",
          locale,
          "settings-plugins.ts"
        ),
        "utf-8"
      );
      expect(text).toMatch(/permissionLabels:\s*pluginPermissions/);
    }
  });
});
