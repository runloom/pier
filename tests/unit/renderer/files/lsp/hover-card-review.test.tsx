import { FilesLspHoverCard } from "@plugins/builtin/files/renderer/lsp/hover-card.tsx";
import type {
  FilesLspHoverCardModel,
  FilesLspPreparedDefinition,
} from "@plugins/builtin/files/renderer/lsp/hover-types.ts";
import { render, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const LABELS: FilesLspHoverCardModel["labels"] = {
  contentTruncated: "Documentation was truncated",
  definitionsTitle: "Definitions",
  definitionsTruncated: "Only the first definitions are shown",
  documentationTitle: "Documentation",
  goToDefinitionFailed: "Unable to open that definition.",
  goToDefinitionUnavailable: "Go to Definition is unavailable here.",
  lineTruncated: "Line truncated",
  noInformation: "No symbol information is available here",
  previewUnavailable: "Preview unavailable",
  symbolTitle: "Symbol information",
  unavailable: "Symbol information is temporarily unavailable",
};

// review tests use mode symbol so docs+definitions compose

function definition(
  name: string,
  line: number,
  previewText = `export const ${name} = true;`
): FilesLspPreparedDefinition {
  return {
    path: `/workspace/src/${name}.ts`,
    preview: [
      {
        lineNumber: line + 1,
        text: previewText,
        truncated: false,
      },
    ],
    range: {
      end: { character: 8, line },
      start: { character: 2, line },
    },
    uri: `file:///workspace/src/${name}.ts`,
  };
}

function cardModel(
  overrides: Partial<FilesLspHoverCardModel> = {}
): FilesLspHoverCardModel {
  return {
    activePreviewTarget: null,
    contentTruncated: false,
    definitions: [],
    definitionsShown: 0,
    definitionsTotal: 0,
    definitionsTruncated: false,
    documentation: [],
    error: false,
    labels: LABELS,
    mode: "symbol",
    signatures: [],
    sourcePath: "/workspace/src/current.ts",
    ...overrides,
  };
}

// ensure single-definition focus test has preview path

function renderCard(model: FilesLspHoverCardModel): {
  card: HTMLElement;
  unmount(): void;
} {
  const rendered = render(
    <FilesLspHoverCard
      model={model}
      onActivateDefinition={vi.fn()}
      onDismiss={vi.fn()}
      onMakeSticky={vi.fn()}
    />
  );
  const card = rendered.container.querySelector<HTMLElement>(
    '[data-slot="files-lsp-hover-card"]'
  );
  expect(card).not.toBeNull();
  if (!card) {
    throw new Error("Expected the hover card to render");
  }
  return { card, unmount: rendered.unmount };
}

describe("FilesLspHoverCard review contracts", () => {
  it("focuses the first action inside the card's visible scroll region", () => {
    const previouslyFocused = document.createElement("button");
    document.body.append(previouslyFocused);
    previouslyFocused.focus();
    const target = definition("target", 4);

    const { card, unmount } = renderCard(
      cardModel({
        activePreviewTarget: target,
        definitions: [target],
        definitionsShown: 1,
        definitionsTotal: 1,
        // symbol mode auto-focuses (Mod+I); single-def surface still applies.
        mode: "symbol",
      })
    );
    const action = card.querySelector<HTMLButtonElement>(
      "button.cm-lsp-definition-location"
    );
    expect(action).not.toBeNull();
    const scrollBody = action?.closest<HTMLElement>(
      '[data-slot="files-lsp-hover-body"]'
    );

    expect(document.activeElement).toBe(action);
    expect(scrollBody).toHaveClass("flex-1", "min-h-0", "overflow-y-auto");
    expect(card.className).toMatch(/overflow-hidden/);

    unmount();
    previouslyFocused.remove();
  });

  it("sanitizes composed symbol markdown at the final HTML sink", () => {
    const firstTarget = definition(
      "first",
      10,
      '<script data-preview-injection="true">preview()</script>'
    );
    const secondTarget: FilesLspPreparedDefinition = {
      ...definition("second", 20),
      path: "/workspace/<iframe data-path-injection=true>second.ts",
    };
    const composedHtml = [
      '<pre class="tok-code hostile"><code>',
      '<a class="tok-link" href="javascript:alert(1)" ping="https://tracker.invalid">unsafe</a>',
      '<a class="tok-link hostile" href="https://docs.example/safe" ping="https://tracker.invalid">safe</a>',
      '<span class="tok-signature" href="file:///workspace/secret.ts">decorated</span>',
      "</code></pre>",
    ].join("");
    const { card } = renderCard(
      cardModel({
        activePreviewTarget: firstTarget,
        definitions: [firstTarget, secondTarget],
        definitionsShown: 2,
        documentation: [
          {
            html: composedHtml,
            kind: "markdown",
            value: "**raw markdown must not also be rendered**",
          },
          {
            kind: "plaintext",
            value:
              '<em data-plaintext-injection="true">plain documentation</em>',
          },
        ],
        signatures: [
          {
            language: "typescript",
            value: '<img data-signature-injection="true" src="invalid">',
          },
        ],
      })
    );
    const renderedMarkdown = card.querySelector<HTMLElement>("pre.tok-code");
    expect(renderedMarkdown).not.toBeNull();
    if (!renderedMarkdown) {
      throw new Error("Expected rendered symbol markdown");
    }
    const safeLink = within(renderedMarkdown).getByRole("link", {
      name: "safe",
    });

    expect(renderedMarkdown).not.toHaveClass("hostile");
    expect(renderedMarkdown.closest(".cm-lsp-documentation")).not.toBeNull();
    expect(safeLink).toHaveAttribute("href", "https://docs.example/safe");
    expect(safeLink).toHaveAttribute("rel", "noopener noreferrer");
    expect(card.querySelector("[ping]")).toBeNull();
    expect(card.querySelector('[href^="javascript:"]')).toBeNull();
    expect(card.querySelector('[href^="file:"]')).toBeNull();
    expect(card.querySelector(".tok-signature")).toHaveTextContent("decorated");
    expect(card).toHaveTextContent(
      '<img data-signature-injection="true" src="invalid">'
    );
    expect(card).toHaveTextContent(
      '<script data-preview-injection="true">preview()</script>'
    );
    expect(card.querySelector("img[data-signature-injection]")).toBeNull();
    expect(card.querySelector("script[data-preview-injection]")).toBeNull();
    expect(
      card.querySelectorAll('[data-slot="files-lsp-definition-preview"]')
    ).toHaveLength(1);
  });

  it("renders one active pane with visible truncation and count details", () => {
    const firstTarget = definition("first", 10, "first preview");
    const secondTarget = definition("second", 20, "second preview");
    const activePreviewTarget: FilesLspPreparedDefinition = {
      ...secondTarget,
      preview:
        secondTarget.preview?.map((line) => ({
          ...line,
          truncated: true,
        })) ?? null,
    };
    const { card } = renderCard(
      cardModel({
        activePreviewTarget,
        definitions: [firstTarget, activePreviewTarget],
        definitionsShown: 2,
        definitionsTotal: 12,
        definitionsTruncated: true,
      })
    );
    const previews = card.querySelectorAll<HTMLElement>(
      '[data-slot="files-lsp-definition-preview"]'
    );
    const preview = previews.item(0);
    const countLabel = `${LABELS.definitionsTruncated} (2/12)`;

    expect(previews).toHaveLength(1);
    expect(preview).not.toBeNull();
    if (!preview) {
      throw new Error("Expected one active definition preview");
    }
    expect(preview).toHaveTextContent("second preview");
    expect(preview).not.toHaveTextContent("first preview");
    expect(preview?.querySelector("[title]")?.getAttribute("title")).toBe(
      LABELS.lineTruncated
    );
    expect(within(card).getByText(countLabel, { exact: true })).toBeVisible();
  });
});
