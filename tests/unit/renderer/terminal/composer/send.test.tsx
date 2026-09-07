import type { TerminalOperationResult } from "@shared/contracts/terminal.ts";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  appendComposerEdit,
  getOrCreateTerminalComposerSession,
  readComposerAttachments,
  readComposerDraft,
  readComposerEditorSnapshot,
  readReviewChipDraft,
  resetTerminalComposerSessionsForTests,
  type TerminalComposerSession,
  writeComposerAttachments,
  writeComposerDraft,
  writeComposerEditorSnapshot,
  writeReviewChipDraft,
} from "@/panel-kits/terminal/composer/session.ts";
import { useTerminalComposerSend } from "@/panel-kits/terminal/hooks/use-composer-send.ts";
import { ensureTuiInputFocus } from "@/panel-kits/terminal/tui-input-focus.ts";
import { showAppAlert } from "@/stores/app-dialog.store.ts";
import { useForegroundActivityStore } from "@/stores/foreground-activity.store.ts";

vi.mock("@/stores/app-dialog.store.ts", () => ({
  showAppAlert: vi.fn(async () => undefined),
  showAppConfirm: vi.fn(async () => false),
}));
vi.mock("@/panel-kits/terminal/tui-input-focus.ts", () => ({
  ensureTuiInputFocus: vi.fn(async () => true),
}));

const sendText = vi.fn<(args: unknown) => Promise<TerminalOperationResult>>();
const beginImageSuppress = vi.fn<() => Promise<void>>();
const endImageSuppress = vi.fn<() => Promise<void>>();

function mountSend(
  session: TerminalComposerSession,
  getDraft = () => readComposerDraft(session)
) {
  const onSent = vi.fn();
  const hook = renderHook(() =>
    useTerminalComposerSend({
      buildPayloadOrReport: (draft) => draft || null,
      disabled: false,
      getDraft,
      isComposing: () => false,
      onSent,
      session,
      t: (key) => key,
    })
  );
  return { ...hook, onSent };
}

beforeEach(() => {
  vi.useFakeTimers();
  sendText.mockReset().mockResolvedValue({ ok: true });
  beginImageSuppress.mockReset().mockResolvedValue(undefined);
  endImageSuppress.mockReset().mockResolvedValue(undefined);
  vi.mocked(showAppAlert).mockClear();
  vi.mocked(ensureTuiInputFocus).mockResolvedValue(true);
  useForegroundActivityStore.setState({ activities: {} });
  Object.defineProperty(window, "pier", {
    configurable: true,
    value: {
      clipboard: { beginImageSuppress, endImageSuppress },
      terminal: { sendText },
    },
  });
});

afterEach(() => {
  cleanup();
  resetTerminalComposerSessionsForTests();
  useForegroundActivityStore.setState({ activities: {} });
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("composer sends across view lifetimes", () => {
  it("blocks a remounted duplicate and preserves the newer draft when the old send completes", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(session, "first draft");
    const delivery = Promise.withResolvers<TerminalOperationResult>();
    sendText.mockReturnValueOnce(delivery.promise);
    const first = mountSend(session);
    act(() => first.result.current.send());
    first.unmount();
    writeComposerDraft(session, "new draft");
    const next = mountSend(session);

    expect(next.result.current.sending).toBe(true);
    act(() => next.result.current.send());
    expect(sendText).toHaveBeenCalledTimes(1);
    await act(async () => {
      delivery.resolve({ ok: true });
    });
    expect(readComposerDraft(session)).toBe("new draft");
    expect(first.onSent).not.toHaveBeenCalled();
    expect(next.onSent).not.toHaveBeenCalled();
    expect(next.result.current.sending).toBe(false);

    await act(async () => next.result.current.send());
    expect(sendText).toHaveBeenLastCalledWith({
      panelId: "terminal",
      submit: true,
      text: "new draft",
    });
    expect(readComposerDraft(session)).toBe("");
    expect(next.onSent).toHaveBeenCalledTimes(1);
  });

  it("commits unchanged editor content while hidden without calling the old view completion", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(session, "stale React draft");
    writeComposerEditorSnapshot(session, "snapshot");
    writeReviewChipDraft(session, {
      count: 1,
      label: "Comments",
      payloadText: "review",
    });
    writeComposerAttachments(session, [
      { id: "file", kind: "file", name: "file", path: "/file" },
    ]);
    const delivery = Promise.withResolvers<TerminalOperationResult>();
    sendText.mockReturnValueOnce(delivery.promise);
    const first = mountSend(session, () => "current editor draft");
    act(() => first.result.current.send());
    first.unmount();
    expect(readComposerDraft(session)).toBe("current editor draft");
    await act(async () => {
      delivery.resolve({ ok: true });
    });

    expect(readComposerDraft(session)).toBe("");
    expect(readComposerEditorSnapshot(session)).toBeNull();
    expect(readReviewChipDraft(session)).toBeNull();
    expect(readComposerAttachments(session)).toEqual([]);
    expect(first.onSent).not.toHaveBeenCalled();
    const next = mountSend(session);
    expect(next.result.current.sending).toBe(false);
    act(() => next.result.current.send());
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("keeps the send locked through failed delivery clipboard cleanup, then permits retry", async () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    useForegroundActivityStore.setState({
      activities: {
        terminal: {
          agentId: "crush",
          kind: "agent",
          panelId: "terminal",
          source: "hook",
          status: "ready",
          subagentCount: 0,
          spawnedAt: 1,
          updatedAt: 1,
          windowId: "window",
        },
      },
    });
    writeComposerDraft(session, "retry draft");
    sendText.mockRejectedValueOnce(new Error("send failed"));
    const clipboardReleased = Promise.withResolvers<void>();
    endImageSuppress.mockReturnValueOnce(clipboardReleased.promise);
    const view = mountSend(session);
    await act(async () => view.result.current.send());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(endImageSuppress).toHaveBeenCalledTimes(1);
    expect(view.result.current.sending).toBe(true);
    act(() => view.result.current.send());
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(readComposerDraft(session)).toBe("retry draft");

    await act(async () => clipboardReleased.resolve());
    expect(view.result.current.sending).toBe(false);
    expect(showAppAlert).toHaveBeenCalledTimes(1);
    expect(view.onSent).not.toHaveBeenCalled();
    await act(async () => view.result.current.send());
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(readComposerDraft(session)).toBe("");
    expect(view.onSent).toHaveBeenCalledTimes(1);
    expect(view.result.current.sending).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(view.result.current.sending).toBe(false);
    expect(beginImageSuppress).toHaveBeenCalledTimes(2);
    expect(endImageSuppress).toHaveBeenCalledTimes(2);
  });

  it("does not submit while hidden edits are still unapplied", () => {
    const session = getOrCreateTerminalComposerSession("terminal");
    writeComposerDraft(session, "body");
    expect(appendComposerEdit(session, { kind: "text", text: "pending" })).toBe(
      true
    );
    const view = mountSend(session);
    act(() => view.result.current.send());
    expect(sendText).not.toHaveBeenCalled();
    expect(readComposerDraft(session)).toBe("body");
  });
});
