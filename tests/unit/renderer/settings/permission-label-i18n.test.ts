// @vitest-environment jsdom

import { pierCapabilitySchema } from "@shared/contracts/permissions.ts";
import i18next from "i18next";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import { pluginPermissions } from "@/i18n/locales/en/plugin-permissions.ts";
import { capabilityPermissionLabel } from "@/pages/settings/components/plugin-row.tsx";

describe("permission label i18n lookup", () => {
  beforeAll(async () => {
    await initI18n();
    await i18next.changeLanguage("en");
  });

  it("resolves every colon-containing PierCapability to the human label", () => {
    const t = i18next.getFixedT("en");
    const colonIds = pierCapabilitySchema.options.filter((id) =>
      id.includes(":")
    );
    expect(colonIds.length).toBeGreaterThan(10);
    for (const id of colonIds) {
      const expected = pluginPermissions[id as keyof typeof pluginPermissions];
      expect(capabilityPermissionLabel(t, id)).toBe(expected);
      expect(capabilityPermissionLabel(t, id)).not.toBe(id);
    }
  });
});
