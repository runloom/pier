import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { MarkdownCodeBlock } from "@plugins/builtin/files/renderer/markdown/code-block.tsx";
import {
  bindMarkdownCodeWrapFromConfiguration,
  useMarkdownPreviewPrefsStore,
} from "@plugins/builtin/files/renderer/markdown/preview-preferences.ts";
import { FILES_EDITOR_WORD_WRAP_SETTING_KEY } from "@plugins/builtin/files/settings.ts";
import {
  createConfigurationChangeEvent,
  type PluginConfigurationChangeEvent,
} from "@shared/plugin-settings.ts";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Minimal configuration fake mirroring the real PluginConfigurationApi
// contract: events carry `affectsConfiguration(prefix)` (no `key` field),
// matching how the host emits changes (see createConfigurationChangeEvent).
const listeners = new Set<(event: PluginConfigurationChangeEvent) => void>();
const state = { wordWrap: false };

function configurationGet<T>(key: string): T {
  return (key === FILES_EDITOR_WORD_WRAP_SETTING_KEY
    ? state.wordWrap
    : undefined) as unknown as T;
}

const configuration: Pick<
  RendererPluginContext["configuration"],
  "get" | "onDidChange"
> = {
  get: configurationGet,
  onDidChange: (listener) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

function setKey(key: string, value: boolean) {
  state.wordWrap = value;
  const event = createConfigurationChangeEvent([key]);
  for (const listener of listeners) listener(event);
}

describe("markdown code wrap binding", () => {
  afterEach(() => {
    listeners.clear();
    state.wordWrap = false;
    useMarkdownPreviewPrefsStore.setState({ codeWrap: false });
  });

  it("mirrors configuration into store and stops after dispose", () => {
    const dispose = bindMarkdownCodeWrapFromConfiguration(configuration);
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(false);
    setKey(FILES_EDITOR_WORD_WRAP_SETTING_KEY, true);
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(true);
    dispose();
    setKey(FILES_EDITOR_WORD_WRAP_SETTING_KEY, false);
    expect(useMarkdownPreviewPrefsStore.getState().codeWrap).toBe(true);
  });
});

describe("code block wrap toggle button", () => {
  it("invokes toggle handler", () => {
    const onToggleWordWrap = vi.fn();
    render(
      <MarkdownCodeBlock
        code={"a".repeat(80)}
        labels={{
          copiedCode: "Copied",
          copyCode: "Copy code",
          wrapOn: "Word Wrap: On",
          wrapOff: "Word Wrap: Off",
        }}
        language="text"
        meta={null}
        onToggleWordWrap={onToggleWordWrap}
        theme="dark"
        wordWrap={false}
      />
    );
    fireEvent.click(screen.getByRole("button", { name: "Word Wrap: Off" }));
    expect(onToggleWordWrap).toHaveBeenCalledTimes(1);
  });

  it("toggles pre wrapping classes with wordWrap prop", () => {
    const props = {
      code: "a".repeat(80),
      labels: {
        copiedCode: "Copied",
        copyCode: "Copy code",
        wrapOn: "Word Wrap: On",
        wrapOff: "Word Wrap: Off",
      },
      language: "text",
      meta: null,
      theme: "dark" as const,
    };
    const { container, rerender } = render(
      <MarkdownCodeBlock {...props} wordWrap={false} />
    );
    const pre = container.querySelector("pre");
    expect(pre?.className).not.toContain("whitespace-pre-wrap");
    rerender(<MarkdownCodeBlock {...props} wordWrap={true} />);
    expect(pre?.className).toContain("whitespace-pre-wrap");
    expect(pre?.className).toContain("break-words");
  });
});
