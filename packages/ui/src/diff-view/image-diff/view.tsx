import { ToggleGroup, ToggleGroupItem } from "../../toggle-group.tsx";
import { OnionImageDiff, SwipeImageDiff } from "./compare.tsx";
import { ImagePane } from "./frame.tsx";
import { imageDiffStage } from "./stage.ts";
import type {
  PierImageDiffLabels,
  PierImageDiffMode,
  PierImageDiffSide,
} from "./types.ts";

const PANE_CLASS = "min-w-0 max-w-full";

export function ImageDiffView({
  after,
  afterUrl,
  before,
  beforeUrl,
  labels,
  locale,
  mode,
  onModeChange,
}: {
  readonly after: PierImageDiffSide | null;
  readonly afterUrl: string | null;
  readonly before: PierImageDiffSide | null;
  readonly beforeUrl: string | null;
  readonly labels: PierImageDiffLabels;
  readonly locale: string;
  readonly mode: PierImageDiffMode;
  readonly onModeChange: (mode: PierImageDiffMode) => void;
}): React.JSX.Element {
  const comparable = before !== null && after !== null;
  const resolvedMode = comparable ? mode : "two-up";
  const stage = imageDiffStage(before, after);
  return (
    <div
      className="flex w-full min-w-0 justify-center"
      data-slot="pier-image-diff"
    >
      <div className="flex w-fit min-w-0 max-w-full flex-col items-center">
        {resolvedMode === "swipe" && comparable ? (
          <SwipeImageDiff
            after={after}
            afterUrl={afterUrl}
            before={before}
            beforeUrl={beforeUrl}
            labels={labels}
            locale={locale}
            stage={stage}
          />
        ) : null}
        {resolvedMode === "onion" && comparable ? (
          <OnionImageDiff
            after={after}
            afterUrl={afterUrl}
            before={before}
            beforeUrl={beforeUrl}
            labels={labels}
            locale={locale}
            stage={stage}
          />
        ) : null}
        {resolvedMode === "two-up" ? (
          <div className="flex w-fit min-w-0 max-w-full justify-center gap-6 px-3 py-4">
            {before ? (
              <div className={PANE_CLASS}>
                <ImagePane
                  accent="deletion"
                  caption={labels.deleted}
                  labels={labels}
                  locale={locale}
                  side={before}
                  stage={stage}
                  url={beforeUrl}
                />
              </div>
            ) : null}
            {after ? (
              <div className={PANE_CLASS}>
                <ImagePane
                  accent="addition"
                  caption={labels.added}
                  labels={labels}
                  locale={locale}
                  side={after}
                  stage={stage}
                  url={afterUrl}
                />
              </div>
            ) : null}
          </div>
        ) : null}
        {comparable ? (
          <ImageDiffModeSwitch
            labels={labels}
            mode={resolvedMode}
            onModeChange={onModeChange}
          />
        ) : null}
      </div>
    </div>
  );
}

function ImageDiffModeSwitch({
  labels,
  mode,
  onModeChange,
}: {
  readonly labels: PierImageDiffLabels;
  readonly mode: PierImageDiffMode;
  readonly onModeChange: (mode: PierImageDiffMode) => void;
}): React.JSX.Element {
  return (
    <div className="flex justify-center px-3 pb-4">
      <ToggleGroup
        aria-label={labels.compare}
        onValueChange={(value) => {
          if (value === "two-up" || value === "swipe" || value === "onion") {
            onModeChange(value);
          }
        }}
        spacing={0}
        type="single"
        value={mode}
        variant="outline"
      >
        <ToggleGroupItem value="two-up">{labels.twoUp}</ToggleGroupItem>
        <ToggleGroupItem value="swipe">{labels.swipe}</ToggleGroupItem>
        <ToggleGroupItem value="onion">{labels.onionSkin}</ToggleGroupItem>
      </ToggleGroup>
    </div>
  );
}
