import { useRetryDocumentsAfterIndexRefresh } from "@plugins/builtin/git/renderer/hooks/use-retry-after-index-refresh.ts";
import type { GitReviewDocumentLoader } from "@plugins/builtin/git/renderer/review/document/loader.ts";
import { cleanup, render } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

function Harness({
  indexRefreshing,
  loader,
}: {
  readonly indexRefreshing: boolean;
  readonly loader: Pick<GitReviewDocumentLoader, "retryRetryableFailures">;
}) {
  const loaderRef = useRef(loader);
  loaderRef.current = loader;
  useRetryDocumentsAfterIndexRefresh({
    indexRefreshing,
    loaderRef,
  });
  return null;
}

afterEach(() => {
  cleanup();
});

describe("useRetryDocumentsAfterIndexRefresh", () => {
  it("retries timed-out documents when a user refresh settles", () => {
    const retryRetryableFailures = vi.fn();
    const loader = { retryRetryableFailures };
    const view = render(<Harness indexRefreshing={false} loader={loader} />);
    expect(retryRetryableFailures).not.toHaveBeenCalled();

    view.rerender(<Harness indexRefreshing loader={loader} />);
    expect(retryRetryableFailures).not.toHaveBeenCalled();

    view.rerender(<Harness indexRefreshing={false} loader={loader} />);
    expect(retryRetryableFailures).toHaveBeenCalledOnce();
  });

  it("does not retry on watch-driven refreshes that never set refreshing", () => {
    const retryRetryableFailures = vi.fn();
    const loader = { retryRetryableFailures };
    const view = render(<Harness indexRefreshing={false} loader={loader} />);
    view.rerender(<Harness indexRefreshing={false} loader={loader} />);
    expect(retryRetryableFailures).not.toHaveBeenCalled();
  });
});
