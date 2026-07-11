import { act, renderHook } from "@testing-library/react";
import i18next from "i18next";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useT } from "@/i18n/use-t.ts";

describe("useT", () => {
  beforeEach(async () => {
    await i18next.init({
      fallbackLng: "en",
      lng: "en",
      resources: {
        en: { translation: { greeting: "Hello" } },
        "zh-CN": { translation: { greeting: "你好" } },
      },
    });
  });

  afterEach(() => {
    i18next.removeResourceBundle("en", "translation");
    i18next.removeResourceBundle("zh-CN", "translation");
  });

  it("keeps translator identity stable until the language changes", async () => {
    const hook = renderHook(() => useT());
    const english = hook.result.current;
    hook.rerender();
    expect(hook.result.current).toBe(english);
    expect(hook.result.current("greeting")).toBe("Hello");

    await act(async () => {
      await i18next.changeLanguage("zh-CN");
    });
    expect(hook.result.current).not.toBe(english);
    expect(hook.result.current("greeting")).toBe("你好");
  });
});
