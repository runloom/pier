import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import {
  clearFilesDocumentStore,
  ensureDiskDocument,
  markDocumentReadResult,
  updateDocumentContents,
} from "@plugins/builtin/files/renderer/document/store.ts";
import {
  FileHtmlPreview,
  HTML_PREVIEW_TOUCH_INTERVAL_MS,
} from "@plugins/builtin/files/renderer/preview/html.tsx";
import type { HtmlPreviewTicketIssueResult } from "@shared/contracts/file/html-preview-ticket.ts";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PROJECT_ROOT = "/workspace/pier";
const t = (key: string, fallback?: string) => fallback ?? key;

type IssueFn = RendererPluginContext["htmlPreviews"]["issue"];

function createContext(
  issue: IssueFn,
  release: () => Promise<boolean>,
  touch: () => Promise<boolean> = async () => true
) {
  return {
    htmlPreviews: { issue, release, touch },
  } as unknown as RendererPluginContext;
}

function readResult(revision: string, contents = "<!doctype html>") {
  return {
    canonicalPath: "demo.html",
    contents,
    eol: "lf" as const,
    format: { bom: false as const, encoding: "utf8" as const },
    kind: "text" as const,
    mode: 0o644,
    mtimeMs: 1,
    path: "demo.html",
    revision,
    root: PROJECT_ROOT,
    size: contents.length,
    writable: true,
  };
}

let ticketSerial = 0;

function createIssue() {
  return vi.fn<IssueFn>(async () => {
    ticketSerial += 1;
    return {
      issued: true as const,
      relPath: "demo.html",
      ticket: `html-ticket-${String(ticketSerial).padStart(24, "0")}`,
    };
  });
}

function openDocument(documentId: string) {
  ensureDiskDocument({
    documentId,
    name: "demo.html",
    path: "demo.html",
    root: PROJECT_ROOT,
  });
  markDocumentReadResult(documentId, readResult("file-v1:one"));
}

function lastIframe(): HTMLIFrameElement {
  const iframe = document.querySelector("iframe");
  expect(iframe).not.toBeNull();
  return iframe as HTMLIFrameElement;
}

beforeEach(() => {
  ticketSerial = 0;
});

afterEach(() => {
  clearFilesDocumentStore();
  vi.useRealTimers();
});

describe("FileHtmlPreview", () => {
  it("shows a loading skeleton until the ticket is issued", async () => {
    openDocument("disk:html-preview-loading");
    const { promise, resolve } =
      Promise.withResolvers<HtmlPreviewTicketIssueResult>();
    const issue = vi.fn<IssueFn>(() => promise);
    const release = vi.fn(async () => true);

    render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-loading"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );

    expect(
      document.querySelector('[data-slot="file-html-preview-loading"]')
    ).not.toBeNull();
    expect(document.querySelector("iframe")).toBeNull();

    await act(async () => {
      resolve({
        issued: true,
        relPath: "demo.html",
        ticket: `html-ticket-${"1".repeat(24)}`,
      });
    });

    await waitFor(() => {
      expect(lastIframe().getAttribute("sandbox")).toBe("allow-scripts");
    });
    expect(
      document.querySelector('[data-slot="file-html-preview-loading"]')
    ).not.toBeNull();

    fireEvent.load(lastIframe());
    expect(
      document.querySelector('[data-slot="file-html-preview-loading"]')
    ).toBeNull();
  });

  it("renders the sandboxed iframe with a ticketed preview url", async () => {
    openDocument("disk:html-preview-basic");
    const issue = createIssue();
    const release = vi.fn(async () => true);

    render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-basic"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );

    await waitFor(() => {
      expect(lastIframe().src.startsWith("pier-html-preview://preview/")).toBe(
        true
      );
    });
    expect(lastIframe().getAttribute("sandbox")).toBe("allow-scripts");
    expect(lastIframe().getAttribute("sandbox")).not.toContain(
      "allow-same-origin"
    );
    expect(lastIframe().src).toContain("/demo.html");
    expect(issue).toHaveBeenCalledWith({
      path: "demo.html",
      root: PROJECT_ROOT,
    });
  });

  it("keeps the live iframe until the replacement frame loads", async () => {
    openDocument("disk:html-preview-reload");
    const issue = createIssue();
    const release = vi.fn(async () => true);
    render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-reload"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );
    await waitFor(() => {
      expect(lastIframe().src).toContain("html-ticket-");
    });
    fireEvent.load(lastIframe());
    const firstSrc = lastIframe().src;

    act(() => {
      markDocumentReadResult(
        "disk:html-preview-reload",
        readResult("file-v1:two", "<!doctype html><p>v2</p>")
      );
    });

    await waitFor(() => {
      expect(document.querySelectorAll("iframe")).toHaveLength(2);
    });
    const live = document.querySelector(
      '[data-slot="file-html-preview-frame"]'
    );
    const pending = document.querySelector(
      '[data-slot="file-html-preview-frame-pending"]'
    );
    expect(live).toBeInstanceOf(HTMLIFrameElement);
    expect(pending).toBeInstanceOf(HTMLIFrameElement);
    expect((live as HTMLIFrameElement).src).toBe(firstSrc);
    expect((pending as HTMLIFrameElement).src).not.toBe(firstSrc);
    expect(
      document.querySelector('[data-slot="file-html-preview-loading"]')
    ).toBeNull();
    expect(issue).toHaveBeenLastCalledWith({
      path: "demo.html",
      root: PROJECT_ROOT,
    });

    fireEvent.load(pending as HTMLIFrameElement);
    await waitFor(() => {
      expect(document.querySelectorAll("iframe")).toHaveLength(1);
    });
    expect(lastIframe().src).not.toBe(firstSrc);
    expect(release).toHaveBeenCalledWith(
      "html-ticket-000000000000000000000001"
    );
  });

  it("shows a retry affordance when ticket issue fails", async () => {
    openDocument("disk:html-preview-error");
    const issue = vi
      .fn<IssueFn>()
      .mockResolvedValueOnce({ issued: false as const, reason: "not-found" })
      .mockResolvedValue({
        issued: true as const,
        relPath: "demo.html",
        ticket: `html-ticket-${"9".repeat(24)}`,
      });
    const release = vi.fn(async () => true);

    render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-error"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );

    const retry = await screen.findByRole("button", { name: "Retry" });
    expect(screen.getByText("Couldn’t load preview")).toBeVisible();
    expect(
      screen.getByText(
        "This file could not be found. It may have been moved or deleted."
      )
    ).toBeVisible();

    act(() => {
      retry.click();
    });

    await waitFor(() => {
      expect(lastIframe().src).toContain("pier-html-preview://preview/");
    });
    expect(issue).toHaveBeenCalledTimes(2);
  });

  it("releases the active ticket on unmount", async () => {
    openDocument("disk:html-preview-unmount");
    const issue = createIssue();
    const release = vi.fn(async () => true);
    const view = render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-unmount"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );
    await waitFor(() => {
      expect(lastIframe().src).toContain("html-ticket-");
    });

    view.unmount();

    expect(release).toHaveBeenCalledWith(
      "html-ticket-000000000000000000000001"
    );
  });

  it("shows a one-line dirty hint without an alert", async () => {
    openDocument("disk:html-preview-dirty");
    const issue = createIssue();
    const release = vi.fn(async () => true);
    render(
      <FileHtmlPreview
        context={createContext(issue, release)}
        documentId="disk:html-preview-dirty"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );
    await waitFor(() => {
      expect(lastIframe().src).toContain("html-ticket-");
    });
    expect(
      screen.queryByText("Preview shows the saved file. Save to update it.")
    ).toBeNull();

    act(() => {
      updateDocumentContents(
        "disk:html-preview-dirty",
        "<!doctype html><p>unsaved</p>"
      );
    });

    await waitFor(() => {
      expect(
        screen.getByText("Preview shows the saved file. Save to update it.")
      ).toBeVisible();
    });
    expect(
      screen
        .getByText("Preview shows the saved file. Save to update it.")
        .closest('[data-slot="file-html-preview-dirty"]')
    ).not.toBeNull();
    expect(
      screen
        .getByText("Preview shows the saved file. Save to update it.")
        .closest('[data-slot="alert"]')
    ).toBeNull();
  });

  it("touches the live ticket on the heartbeat interval", async () => {
    vi.useFakeTimers();
    openDocument("disk:html-preview-touch");
    const issue = createIssue();
    const release = vi.fn(async () => true);
    const touch = vi.fn(async () => true);
    render(
      <FileHtmlPreview
        context={createContext(issue, release, touch)}
        documentId="disk:html-preview-touch"
        path="demo.html"
        root={PROJECT_ROOT}
        t={t}
      />
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(lastIframe().src).toContain("html-ticket-");

    await act(async () => {
      vi.advanceTimersByTime(HTML_PREVIEW_TOUCH_INTERVAL_MS);
    });
    expect(touch).toHaveBeenCalledWith("html-ticket-000000000000000000000001");
  });
});
