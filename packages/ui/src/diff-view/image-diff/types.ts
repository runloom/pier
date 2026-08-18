export type PierImageDiffMode = "onion" | "swipe" | "two-up";

export type PierImageDiffLocator =
  | {
      readonly absolutePath: string;
      readonly kind: "absolute";
      readonly mime: string;
      readonly revision: string;
    }
  | {
      readonly gitRoot: string;
      readonly kind: "blob";
      readonly mime: string;
      readonly oid: string;
      readonly revision: string;
    };

export interface PierImageDiffSide {
  readonly byteSize: number;
  readonly height: number | null;
  readonly locator: PierImageDiffLocator;
  readonly width: number | null;
}

export interface PierImageDiffLabels {
  readonly added: string;
  readonly compare: string;
  readonly deleted: string;
  readonly dimensions: string;
  readonly loadFailed: string;
  readonly onionSkin: string;
  readonly swipe: string;
  readonly twoUp: string;
}

export interface PierDiffViewImageDiff {
  readonly labels: PierImageDiffLabels;
  readonly locale: string;
  release(ticket: string): void;
  resolve(
    locator: PierImageDiffLocator
  ): Promise<{ ticket: string; url: string } | null>;
}

export interface PierDiffViewItemImageDiff {
  readonly after: PierImageDiffSide | null;
  readonly before: PierImageDiffSide | null;
}
