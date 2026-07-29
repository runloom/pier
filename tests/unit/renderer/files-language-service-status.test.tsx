import {
  clearFilesLanguageServiceStatusOwner,
  type FilesLanguageServiceStatus,
  getFilesLanguageServiceStatus,
  publishFilesLanguageServiceStatus,
  resetFilesLanguageServiceStatusForTests,
  subscribeFilesLanguageServiceStatus,
  useFilesLanguageServiceStatus,
} from "@plugins/builtin/files/renderer/files-language-service-status.ts";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const STATUS_VARIANTS = [
  { state: "disabled", reason: "editor-disabled" },
  { state: "disabled", reason: "globally-disabled" },
  { state: "disabled", reason: "worktrees-disabled" },
  { state: "unsupported", reason: "non-disk" },
  { state: "unsupported", reason: "no-provider" },
  { state: "unsupported", reason: "unsupported-root" },
  { state: "starting" },
  { state: "starting", serverId: "typescript-language-server" },
  { state: "ready", serverId: "typescript-language-server" },
  {
    state: "retrying",
    serverId: "typescript-language-server",
    attempt: 1,
    delayMs: 250,
    reason: "exited",
  },
  {
    state: "retrying",
    serverId: "typescript-language-server",
    attempt: 2,
    delayMs: 1000,
    reason: "failed",
  },
  {
    state: "retrying",
    serverId: "typescript-language-server",
    attempt: 3,
    delayMs: 4000,
    reason: "send-failed",
  },
  {
    state: "retrying",
    serverId: "typescript-language-server",
    attempt: 1,
    delayMs: 250,
    reason: "initialize-failed",
  },
  { state: "paused", reason: "idle-release" },
  {
    state: "paused",
    serverId: "typescript-language-server",
    reason: "workspace-evicted",
  },
  { state: "error", reason: "limit-reached" },
  {
    state: "error",
    serverId: "typescript-language-server",
    reason: "server-unavailable",
  },
  { state: "error", reason: "launch-failed" },
  {
    state: "error",
    serverId: "typescript-language-server",
    reason: "initialize-failed",
  },
  { state: "error", reason: "cleanup-failed" },
  { state: "error", reason: "bridge-unavailable" },
  {
    state: "error",
    serverId: "typescript-language-server",
    reason: "retry-exhausted",
  },
] satisfies readonly FilesLanguageServiceStatus[];

interface StatusProbeProps {
  documentId: string;
  onRender?: ((status: FilesLanguageServiceStatus | null) => void) | undefined;
  ownerId: string;
  testId: string;
}

function StatusProbe({
  documentId,
  onRender,
  ownerId,
  testId,
}: StatusProbeProps) {
  const status = useFilesLanguageServiceStatus(ownerId, documentId);
  onRender?.(status);
  return <output data-testid={testId}>{JSON.stringify(status)}</output>;
}

function TwoOwnerStatusConsumer({
  documentId,
  onFirstRender,
  onSecondRender,
}: {
  documentId: string;
  onFirstRender?: (status: FilesLanguageServiceStatus | null) => void;
  onSecondRender?: (status: FilesLanguageServiceStatus | null) => void;
}) {
  return (
    <>
      <StatusProbe
        documentId={documentId}
        onRender={onFirstRender}
        ownerId="owner-a"
        testId="owner-a-status"
      />
      <StatusProbe
        documentId={documentId}
        onRender={onSecondRender}
        ownerId="owner-b"
        testId="owner-b-status"
      />
    </>
  );
}

function expectRenderedStatus(
  testId: string,
  status: FilesLanguageServiceStatus | null
): void {
  expect(screen.getByTestId(testId)).toHaveTextContent(JSON.stringify(status));
}

beforeEach(() => {
  resetFilesLanguageServiceStatusForTests();
});

afterEach(() => {
  cleanup();
  resetFilesLanguageServiceStatusForTests();
});

describe("files language service status store", () => {
  it.each(
    STATUS_VARIANTS
  )("publishes and gets $state/$reason by exact owner and document", (status) => {
    const documentId = `document-${STATUS_VARIANTS.indexOf(status)}`;

    publishFilesLanguageServiceStatus("owner-a", documentId, status);

    expect(getFilesLanguageServiceStatus("owner-a", documentId)).toEqual(
      status
    );
    expect(getFilesLanguageServiceStatus("owner-b", documentId)).toBeNull();
    expect(
      getFilesLanguageServiceStatus("owner-a", `${documentId}-other`)
    ).toBeNull();
  });

  it("does not advance the hook snapshot revision or notify for a same-value publish", () => {
    const listener = vi.fn();
    const renderStatus = vi.fn();
    const unsubscribe = subscribeFilesLanguageServiceStatus(listener);
    render(
      <StatusProbe
        documentId="document-a"
        onRender={renderStatus}
        ownerId="owner-a"
        testId="status"
      />
    );
    const initialRenderCount = renderStatus.mock.calls.length;
    const status = {
      state: "retrying",
      serverId: "typescript-language-server",
      attempt: 2,
      delayMs: 1000,
      reason: "send-failed",
    } satisfies FilesLanguageServiceStatus;

    act(() => {
      publishFilesLanguageServiceStatus("owner-a", "document-a", status);
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(renderStatus).toHaveBeenCalledTimes(initialRenderCount + 1);
    expectRenderedStatus("status", status);

    const renderCountAfterFirstPublish = renderStatus.mock.calls.length;
    act(() => {
      publishFilesLanguageServiceStatus("owner-a", "document-a", {
        ...status,
      });
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(renderStatus).toHaveBeenCalledTimes(renderCountAfterFirstPublish);
    expectRenderedStatus("status", status);
    unsubscribe();
  });

  it("keeps the same document isolated between two hook owners", () => {
    render(<TwoOwnerStatusConsumer documentId="shared-document" />);
    const ready = {
      state: "ready",
      serverId: "typescript-language-server",
    } satisfies FilesLanguageServiceStatus;
    const disabled = {
      state: "disabled",
      reason: "editor-disabled",
    } satisfies FilesLanguageServiceStatus;

    act(() => {
      publishFilesLanguageServiceStatus("owner-a", "shared-document", ready);
      publishFilesLanguageServiceStatus("owner-b", "shared-document", disabled);
    });

    expectRenderedStatus("owner-a-status", ready);
    expectRenderedStatus("owner-b-status", disabled);
    expect(getFilesLanguageServiceStatus("owner-a", "shared-document")).toEqual(
      ready
    );
    expect(getFilesLanguageServiceStatus("owner-b", "shared-document")).toEqual(
      disabled
    );
  });

  it("clears every key for one owner without removing another owner's keys", () => {
    const ready = {
      state: "ready",
      serverId: "typescript-language-server",
    } satisfies FilesLanguageServiceStatus;
    const paused = {
      state: "paused",
      reason: "idle-release",
    } satisfies FilesLanguageServiceStatus;

    publishFilesLanguageServiceStatus("owner-a", "document-a", ready);
    publishFilesLanguageServiceStatus("owner-a", "document-b", paused);
    publishFilesLanguageServiceStatus("owner-b", "document-a", paused);

    clearFilesLanguageServiceStatusOwner("owner-a");

    expect(getFilesLanguageServiceStatus("owner-a", "document-a")).toBeNull();
    expect(getFilesLanguageServiceStatus("owner-a", "document-b")).toBeNull();
    expect(getFilesLanguageServiceStatus("owner-b", "document-a")).toEqual(
      paused
    );
  });

  it("stops notifying a listener after unsubscribe", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeFilesLanguageServiceStatus(listener);

    publishFilesLanguageServiceStatus("owner-a", "document-a", {
      state: "starting",
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    publishFilesLanguageServiceStatus("owner-a", "document-a", {
      state: "ready",
      serverId: "typescript-language-server",
    });
    clearFilesLanguageServiceStatusOwner("owner-a");

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("reset clears all owners and updates both hook consumers", () => {
    const firstOwnerRender = vi.fn();
    const secondOwnerRender = vi.fn();
    render(
      <TwoOwnerStatusConsumer
        documentId="shared-document"
        onFirstRender={firstOwnerRender}
        onSecondRender={secondOwnerRender}
      />
    );
    const firstInitialRenderCount = firstOwnerRender.mock.calls.length;
    const secondInitialRenderCount = secondOwnerRender.mock.calls.length;

    act(() => {
      publishFilesLanguageServiceStatus("owner-a", "shared-document", {
        state: "ready",
        serverId: "typescript-language-server",
      });
      publishFilesLanguageServiceStatus("owner-b", "shared-document", {
        state: "disabled",
        reason: "globally-disabled",
      });
    });
    expect(firstOwnerRender).toHaveBeenCalledTimes(firstInitialRenderCount + 1);
    expect(secondOwnerRender).toHaveBeenCalledTimes(
      secondInitialRenderCount + 1
    );

    act(() => {
      resetFilesLanguageServiceStatusForTests();
    });

    expectRenderedStatus("owner-a-status", null);
    expectRenderedStatus("owner-b-status", null);
    expect(
      getFilesLanguageServiceStatus("owner-a", "shared-document")
    ).toBeNull();
    expect(
      getFilesLanguageServiceStatus("owner-b", "shared-document")
    ).toBeNull();
    expect(firstOwnerRender).toHaveBeenCalledTimes(firstInitialRenderCount + 2);
    expect(secondOwnerRender).toHaveBeenCalledTimes(
      secondInitialRenderCount + 2
    );
  });
});
