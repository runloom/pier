import { EditorState } from "@codemirror/state";
import { EditorView, type TooltipView } from "@codemirror/view";
import {
  createFilesLspHoverTooltip,
  FilesLspHoverCard,
  mountFilesLspHoverCard,
} from "@plugins/builtin/files/renderer/lsp/hover-card.tsx";
import type {
  FilesLspHoverCardModel,
  FilesLspPreparedDefinition,
} from "@plugins/builtin/files/renderer/lsp/hover-types.ts";
import { act, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

const disposals: Array<() => void> = [];

interface MountedCard {
  destroy(): void;
}

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
    definitionsTruncated: false,
    definitionsShown: 0,
    definitionsTotal: 0,
    documentation: [],
    error: false,
    labels: LABELS,
    mode: "documentation",
    signatures: [],
    sourcePath: "/workspace/src/current.ts",
    ...overrides,
  };
}

function mountCard(
  model: FilesLspHoverCardModel,
  callbacks: {
    onActivateDefinition?: (target: FilesLspPreparedDefinition) => void;
    onDismiss?: () => void;
    onMakeSticky?: () => void;
  } = {}
) {
  const container = document.createElement("div");
  document.body.append(container);
  const onActivateDefinition =
    callbacks.onActivateDefinition ??
    vi.fn<(target: FilesLspPreparedDefinition) => void>();
  const onDismiss = callbacks.onDismiss ?? vi.fn<() => void>();
  const onMakeSticky = callbacks.onMakeSticky ?? vi.fn<() => void>();
  let mounted: MountedCard | undefined;

  act(() => {
    mounted = mountFilesLspHoverCard(container, {
      model,
      onActivateDefinition,
      onDismiss,
      onMakeSticky,
    });
  });

  disposals.push(() => {
    act(() => mounted?.destroy());
    container.remove();
  });

  return {
    container,
    onActivateDefinition,
    onDismiss,
    onMakeSticky,
  };
}

function getCard(container: HTMLElement): HTMLElement {
  const card = container.querySelector<HTMLElement>(
    '[data-slot="files-lsp-hover-card"]'
  );
  expect(card).not.toBeNull();
  if (!card) {
    throw new Error("Expected the hover card to be mounted");
  }
  return card;
}

function expectTitle(
  card: HTMLElement,
  expectedTitle: string,
  visible: boolean
): void {
  const labelledBy = card.getAttribute("aria-labelledby");
  expect(labelledBy).toBeTruthy();
  const title = labelledBy ? document.getElementById(labelledBy) : null;
  expect(title).toBe(card.querySelector('[data-slot="files-lsp-hover-title"]'));
  if (visible) {
    expect(title).not.toHaveClass("sr-only");
  } else {
    expect(title).toHaveClass("sr-only");
  }
  expect(title).toHaveTextContent(expectedTitle);
}

function emulateNativeButtonKey(
  button: HTMLButtonElement,
  key: "Enter" | " "
): void {
  button.focus();
  const code = key === "Enter" ? "Enter" : "Space";
  const runKeyDownDefault = fireEvent.keyDown(button, { code, key });
  if (key === "Enter" && runKeyDownDefault) {
    fireEvent.click(button);
  }
  const runKeyUpDefault = fireEvent.keyUp(button, { code, key });
  if (key === " " && runKeyDownDefault && runKeyUpDefault) {
    fireEvent.click(button);
  }
}

function setClientSize(
  element: HTMLElement,
  width: number,
  height: number
): void {
  Object.defineProperties(element, {
    clientHeight: { configurable: true, value: height },
    clientWidth: { configurable: true, value: width },
  });
}

afterEach(() => {
  for (const dispose of disposals.splice(0).reverse()) {
    dispose();
  }
});

describe("FilesLspHoverCard", () => {
  it("uses an editor region for documentation without product chrome", () => {
    const previouslyFocused = document.createElement("button");
    document.body.append(previouslyFocused);
    previouslyFocused.focus();
    disposals.push(() => previouslyFocused.remove());

    const { container } = mountCard(
      cardModel({
        documentation: [{ kind: "plaintext", value: "Helpful documentation" }],
      })
    );
    const card = getCard(container);

    expect(card).toHaveAttribute("role", "region");
    expect(card).toHaveClass("cm-lsp-hover-tooltip");
    expect(card.querySelector(".cm-lsp-documentation")).not.toBeNull();
    expect(card.querySelector('[data-slot="card"]')).toBeNull();
    expectTitle(card, LABELS.documentationTitle, false);
    expect(document.activeElement).toBe(previouslyFocused);
  });

  it("renders single definition as location + preview without a dual-pane list", () => {
    const target = definition("target", 4);
    const { container, onActivateDefinition } = mountCard(
      cardModel({
        activePreviewTarget: target,
        definitions: [target],
        definitionsShown: 1,
        definitionsTotal: 1,
        mode: "definition",
      })
    );
    const card = getCard(container);

    expect(card).toHaveAttribute("role", "region");
    expect(card).toHaveAttribute("data-mode", "definition");
    // No "Definitions (1)" product title — a11y name is location.
    expectTitle(card, "target.ts:5", false);
    expect(card.querySelectorAll(".cm-lsp-definition-target")).toHaveLength(0);
    expect(
      card.querySelector('[data-slot="files-lsp-definition-preview"]')
    ).not.toBeNull();
    expect(card).toHaveTextContent("target.ts:5");

    const location = within(card).getByRole("button", { name: /target\.ts:5/ });
    fireEvent.click(location);
    expect(onActivateDefinition).toHaveBeenCalledWith(target);
  });

  it("exposes multi-definition targets as editor rows and a nonmodal region", () => {
    const targets = [definition("first", 2), definition("second", 7)];
    const onActivateDefinition =
      vi.fn<(target: FilesLspPreparedDefinition) => void>();
    const { container } = mountCard(
      cardModel({
        activePreviewTarget: targets[0] ?? null,
        definitions: targets,
        definitionsShown: 2,
        definitionsTotal: 2,
        mode: "definition",
      }),
      { onActivateDefinition }
    );
    const card = getCard(container);
    expect(card).toHaveAttribute("role", "region");
    const list = card.querySelector<HTMLElement>(
      '[data-slot="files-lsp-hover-definitions"]'
    );
    expect(list).not.toBeNull();
    expect(
      within(list as HTMLElement).getAllByRole("button").length
    ).toBeGreaterThanOrEqual(2);
    // location rows only in the list column (preview may also be a button)
    const targetRows = card.querySelectorAll(".cm-lsp-definition-target");
    expect(targetRows).toHaveLength(2);

    emulateNativeButtonKey(targetRows[0] as HTMLButtonElement, "Enter");
    expect(onActivateDefinition).toHaveBeenCalledWith(targets[0]);
  });

  it("exposes symbol mode as a nonmodal dialog with a visible title", () => {
    const { container } = mountCard(
      cardModel({
        definitions: [definition("target", 4)],
        definitionsShown: 1,
        definitionsTotal: 1,
        documentation: [{ kind: "plaintext", value: "docs" }],
        mode: "symbol",
      })
    );
    const card = getCard(container);
    expect(card).toHaveAttribute("role", "dialog");
    expect(card).toHaveAttribute("aria-modal", "false");
    expectTitle(card, LABELS.symbolTitle, true);
  });

  it("becomes sticky on pointer entry and dismisses on Escape", () => {
    const onDismiss = vi.fn<() => void>();
    const onMakeSticky = vi.fn<() => void>();
    const target = definition("target", 3);
    const { container } = mountCard(
      cardModel({
        activePreviewTarget: target,
        definitions: [target],
        definitionsShown: 1,
        definitionsTotal: 1,
        mode: "definition",
      }),
      { onDismiss, onMakeSticky }
    );
    const card = getCard(container);
    fireEvent.pointerEnter(card);
    expect(onMakeSticky).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(card, { code: "Escape", key: "Escape" });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it("exposes the same public card structure through the component API", () => {
    const rendered = render(
      <FilesLspHoverCard
        model={cardModel({
          documentation: [{ kind: "plaintext", value: "Component content" }],
        })}
        onActivateDefinition={vi.fn()}
        onDismiss={vi.fn()}
        onMakeSticky={vi.fn()}
      />
    );
    disposals.push(() => rendered.unmount());

    const card = getCard(rendered.container);
    expect(card).toHaveAttribute("role", "region");
    expectTitle(card, LABELS.documentationTitle, false);
    expect(
      card.querySelector('[data-slot="files-lsp-hover-body"]')
    ).not.toBeNull();
  });

  it("writes editor size CSS variables when creating a tooltip", () => {
    const host = document.createElement("div");
    document.body.append(host);
    disposals.push(() => host.remove());
    const view = new EditorView({
      parent: host,
      state: EditorState.create({ doc: "const x = 1;" }),
    });
    disposals.push(() => view.destroy());
    setClientSize(view.dom, 800, 600);

    let tooltipView: TooltipView | undefined;
    act(() => {
      const tooltip = createFilesLspHoverTooltip({
        end: 5,
        model: cardModel({
          documentation: [{ kind: "plaintext", value: "tip" }],
        }),
        onActivateDefinition: vi.fn(),
        onCardDom: () => undefined,
        onDismiss: vi.fn(),
        onMakeSticky: vi.fn(),
        pos: 0,
        view,
      });
      tooltipView = tooltip.create(view);
    });
    disposals.push(() => {
      act(() => tooltipView?.destroy?.());
    });

    const root = tooltipView?.dom;
    expect(root?.getAttribute("data-slot")).toBe(
      "files-lsp-hover-tooltip-root"
    );
    expect(
      root?.style.getPropertyValue("--files-lsp-editor-available-width")
    ).toBe("784px");
  });
});
