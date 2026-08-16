import { Tabs, TabsList, TabsTrigger } from "@pier/ui/tabs.tsx";
import type { RendererPluginContext } from "@plugins/api/renderer.ts";
import { pluginText } from "../plugin-text.ts";
import {
  type GitReviewUncommittedGroup,
  reviewGroupForSurface,
  reviewSurfaceForGroup,
} from "./surface-group.ts";
import type { UncommittedGitReviewSurface } from "./surface-types.ts";
import type { GitReviewTreeGroupLabels } from "./tree.tsx";

export function GitReviewSurfaceSwitcher({
  context,
  groups,
  labels,
  onSelect,
  value,
}: {
  readonly context: RendererPluginContext;
  readonly groups: readonly GitReviewUncommittedGroup[];
  readonly labels: GitReviewTreeGroupLabels;
  readonly onSelect: (surface: UncommittedGitReviewSurface) => void;
  readonly value: UncommittedGitReviewSurface;
}): React.JSX.Element {
  const currentGroup = reviewGroupForSurface(value);
  const selectGroup = (group: GitReviewUncommittedGroup) => {
    onSelect(reviewSurfaceForGroup(group) as UncommittedGitReviewSurface);
  };
  return (
    <Tabs
      className="shrink-0 gap-0"
      data-testid="git-review-surface-switcher"
      onValueChange={(group) => {
        selectGroup(group as GitReviewUncommittedGroup);
      }}
      value={currentGroup}
    >
      <TabsList
        aria-label={pluginText(
          context,
          "reviewSurfaceSwitcherLabel",
          "Select change view"
        )}
        variant="line"
      >
        {groups.map((group) => (
          <TabsTrigger
            className="text-xs"
            key={group}
            onKeyDown={(event) => {
              if (group !== currentGroup) {
                return;
              }
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }
              selectGroup(group);
            }}
            onPointerDown={() => {
              if (group === currentGroup) {
                selectGroup(group);
              }
            }}
            value={group}
          >
            {labels[group]}
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );
}
