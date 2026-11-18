import { ImageDiffHost } from "@pier/ui/diff-view/image-diff/host.tsx";
import type {
  PierDiffViewImageDiff,
  PierImageDiffSide,
} from "@pier/ui/diff-view/image-diff/types.ts";
import { fireEvent, render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const labels = {
  added: "Added",
  compare: "Compare",
  deleted: "Deleted",
  dimensions: "{{width}}×{{height}}",
  loadFailed: "Couldn't load this image. Open the file to inspect.",
  onionSkin: "Onion skin",
  swipe: "Swipe",
  twoUp: "2-up",
};

const afterSide: PierImageDiffSide = {
  byteSize: 1024,
  height: 100,
  locator: {
    absolutePath: "/tmp/after.svg",
    kind: "absolute",
    mime: "image/svg+xml",
    revision: "rev-after",
  },
  width: 318,
};

function createImageDiff(): {
  imageDiff: PierDiffViewImageDiff;
  release: ReturnType<typeof vi.fn>;
  resolve: ReturnType<typeof vi.fn>;
} {
  let issued = 0;
  const release = vi.fn();
  const resolve = vi.fn(async () => {
    issued += 1;
    return {
      ticket: `ticket-${String(issued)}`,
      url: `pier-file-preview://file/${String(issued)}`,
    };
  });
  return {
    imageDiff: {
      labels,
      locale: "en",
      release,
      resolve,
    },
    release,
    resolve,
  };
}

function renderHost(imageDiff: PierDiffViewImageDiff) {
  return render(
    <ImageDiffHost
      imageDiff={imageDiff}
      metadata={{ after: afterSide, before: null, kind: "image-diff" }}
    />
  );
}

async function currentImage(container: HTMLElement): Promise<HTMLImageElement> {
  let image: HTMLImageElement | null = null;
  await waitFor(() => {
    image = container.querySelector("img");
    expect(image).not.toBeNull();
  });
  if (image === null) {
    throw new Error("Expected a preview image");
  }
  return image;
}

describe("ImageDiffHost preview ticket retry", () => {
  it("reissues after an error once a load has succeeded, but caps a failure burst", async () => {
    const { imageDiff, release, resolve } = createImageDiff();
    const { container } = renderHost(imageDiff);

    const first = await currentImage(container);
    expect(first.getAttribute("src")).toBe("pier-file-preview://file/1");

    // A successful paint restores the retry budget for the next expiry.
    fireEvent.load(first);
    fireEvent.error(first);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(2));
    const second = await currentImage(container);
    await waitFor(() =>
      expect(second.getAttribute("src")).toBe("pier-file-preview://file/2")
    );
    expect(release).toHaveBeenCalledWith("ticket-1");

    // Another successful paint + error is still recoverable...
    fireEvent.load(second);
    fireEvent.error(second);
    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(3));
    const third = await currentImage(container);
    await waitFor(() =>
      expect(third.getAttribute("src")).toBe("pier-file-preview://file/3")
    );
    expect(release).toHaveBeenCalledWith("ticket-2");

    // ...but a failure burst without a successful load stops after one retry.
    fireEvent.error(third);
    await Promise.resolve();
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(3);
  });

  it("does not retry an unsupported locator that never issues a URL", async () => {
    const resolve = vi.fn(async () => null);
    const { container } = renderHost({
      labels,
      locale: "en",
      release: vi.fn(),
      resolve,
    });

    await waitFor(() => expect(resolve).toHaveBeenCalledTimes(1));
    await Promise.resolve();
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(container.querySelector("img")).toBeNull();
  });
});
