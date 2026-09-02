import { host } from "pier/host";
import { useCallback, useEffect, useState } from "react";
import { en } from "./en.ts";
import { ja } from "./ja.ts";
import { ko } from "./ko.ts";
import { zhCN } from "./zh-CN.ts";

export type CopyKey = keyof typeof en;
export type Translate = (
  key: CopyKey,
  vars?: Record<string, string | number>
) => string;

const CATALOGS = {
  en,
  ja,
  ko,
  "zh-CN": zhCN,
} as const;

function interpolate(
  template: string,
  vars?: Record<string, string | number>
): string {
  if (!vars) {
    return template;
  }
  return template.replace(/\{\{(\w+)\}\}/g, (full, name: string) =>
    vars[name] === undefined ? full : String(vars[name])
  );
}

export function translate(
  locale: string,
  key: CopyKey,
  vars?: Record<string, string | number>
): string {
  const table =
    locale === "zh-CN" || locale === "ja" || locale === "ko" || locale === "en"
      ? CATALOGS[locale]
      : en;
  return interpolate(table[key] ?? en[key], vars);
}

export function localeFromNavigator(): string {
  const tags =
    typeof navigator === "undefined" ? [] : [...navigator.languages];
  for (const tag of tags) {
    const normalized = tag.toLowerCase();
    if (normalized === "zh" || normalized.startsWith("zh-")) {
      return "zh-CN";
    }
    if (normalized === "ja" || normalized.startsWith("ja-")) {
      return "ja";
    }
    if (normalized === "ko" || normalized.startsWith("ko-")) {
      return "ko";
    }
    if (normalized === "en" || normalized.startsWith("en-")) {
      return "en";
    }
  }
  return "en";
}

export function resolveAppletLocale(value: unknown): string {
  if (!value || typeof value !== "object") {
    return localeFromNavigator();
  }
  const language = (value as { language?: unknown }).language;
  if (
    language === "zh-CN" ||
    language === "ja" ||
    language === "ko" ||
    language === "en"
  ) {
    return language;
  }
  return localeFromNavigator();
}

export function useCopy(): { locale: string; t: Translate } {
  const [locale, setLocale] = useState(localeFromNavigator);
  useEffect(() => {
    let cancelled = false;
    const read = async () => {
      try {
        const prefs = await host.invoke({ type: "preferences.read" });
        if (!cancelled) {
          setLocale(resolveAppletLocale(prefs));
        }
      } catch {
        if (!cancelled) {
          setLocale(localeFromNavigator());
        }
      }
    };
    void read();
    let stop: () => void = () => undefined;
    try {
      stop = host.subscribe("pier:preferences:changed", () => {
        void read();
      });
    } catch {
      // Review harness and tests may stub a partial host.
    }
    return () => {
      cancelled = true;
      stop();
    };
  }, []);
  const t = useCallback<Translate>(
    (key, vars) => translate(locale, key, vars),
    [locale]
  );
  return { locale, t };
}

const GENERIC_LANE_TITLES = new Set([
  "backlog",
  "complete",
  "completed",
  "doing",
  "done",
  "in progress",
  "started",
  "to do",
  "todo",
  "unstarted",
]);

export function columnLabel(
  column: { id: string; title: string },
  mapping: "heuristic" | "project",
  t: Translate
): string {
  const canonical =
    column.id === "todo"
      ? "column.todo"
      : column.id === "inProgress"
        ? "column.inProgress"
        : column.id === "done"
          ? "column.done"
          : null;
  if (
    canonical &&
    (mapping === "heuristic" ||
      GENERIC_LANE_TITLES.has(column.title.trim().toLowerCase()))
  ) {
    return t(canonical);
  }
  return column.title;
}

export function startReadyLabel(count: number, t: Translate): string {
  if (count === 1) {
    return t("view.startReadyOne");
  }
  if (count > 1) {
    return t("view.startReadyMany", { count });
  }
  return t("view.startReady");
}
