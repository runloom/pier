import { describe, expect, it } from "vitest";
import type { Action } from "@/lib/actions/types.ts";
import {
  buildActionSearchDocument,
  rankActionSearchDocuments,
} from "@/lib/search/action-search.ts";
import type { SearchDocument } from "@/lib/search/types.ts";

const action = (
  id: string,
  title: string,
  aliases: readonly string[] = []
): Action => ({
  id,
  category: "Panel",
  handler: () => undefined,
  metadata: {
    aliases: () => aliases,
  },
  surfaces: ["command-palette"],
  title: () => title,
});

describe("action search", () => {
  it.each([
    "均分",
    "平分",
    "equalize",
    "balance",
    "junfen",
    "jfmb",
    "pier.panel.equalizeSplits",
  ])("matches equalize panels by title, aliases, pinyin, shortcut, or id: %s", (query) => {
    const doc = buildActionSearchDocument(
      action("pier.panel.equalizeSplits", "均分面板", [
        "平分面板",
        "equalize panels",
        "balance panels",
        "junfen",
        "jfmb",
      ]),
      { shortcutLabel: "Cmd+Shift+=" }
    );

    expect(rankActionSearchDocuments([doc], query)[0]?.document.id).toBe(
      "pier.panel.equalizeSplits"
    );
  });

  it("ranks exact and prefix visible-text matches ahead of fuzzy matches", () => {
    const docs: SearchDocument<Action>[] = [
      buildActionSearchDocument(
        action("pier.panel.fuzzyOnly", "Panels Balance")
      ),
      buildActionSearchDocument(
        action("pier.panel.exactAlias", "Distribute Layout", ["balance panels"])
      ),
      buildActionSearchDocument(
        action("pier.panel.prefixTitle", "Balance Panels Quickly")
      ),
    ];

    expect(
      rankActionSearchDocuments(docs, "balance panels").map(
        (result) => result.document.id
      )
    ).toEqual([
      "pier.panel.exactAlias",
      "pier.panel.prefixTitle",
      "pier.panel.fuzzyOnly",
    ]);
  });

  it("keeps disabled actions visible but marked as disabled", () => {
    const doc = buildActionSearchDocument(
      {
        ...action("pier.panel.equalizeSplits", "均分面板", ["balance panels"]),
        enabled: () => false,
      },
      { disabled: true }
    );

    const result = rankActionSearchDocuments([doc], "balance")[0];

    expect(result?.document.id).toBe("pier.panel.equalizeSplits");
    expect(result?.document.disabled).toBe(true);
  });

  it("uses frecency only as a tie breaker within the same text relevance tier", () => {
    const docs: SearchDocument<Action>[] = [
      buildActionSearchDocument(action("pier.panel.lowUse", "Balance Panels")),
      buildActionSearchDocument(action("pier.panel.highUse", "Balance Layout")),
    ];

    expect(
      rankActionSearchDocuments(docs, "balance", {
        frecencyMap: new Map([
          ["pier.panel.lowUse", 1],
          ["pier.panel.highUse", 50],
        ]),
      }).map((result) => result.document.id)
    ).toEqual(["pier.panel.highUse", "pier.panel.lowUse"]);
  });
});
