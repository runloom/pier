import {
  Artboard,
  Button,
  Field,
  FieldGroup,
  FieldLabel,
  Layer,
  Popover,
  PopoverContent,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
  Row,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Stack,
  Text,
  ToggleGroup,
  ToggleGroupItem,
  WorldStage,
} from "pier/canvas";
import { useId, useState } from "react";
import { COPY, type Locale } from "./copy.ts";
import type { UpdatePhase } from "./footer-copy.ts";
import {
  PeekSpecimen,
  WORKTREE_PEEK_SAMPLES,
  WorktreePeek,
  worktreePeekCaption,
} from "./hover-peeks.tsx";
import { REVIEW_COPY, REVIEW_LANGUAGES } from "./review-copy.ts";
import { type Scenario, SidebarDesign } from "./sidebar-design.tsx";

export const canvas = {
  title: "工作树侧边栏 · 交互设计",
  description: "侧栏交互设计，右侧摊开工作树悬停卡片的全部场景标本。",
  kind: "composition" as const,
};

export default function WorkbenchSidebarReview() {
  const id = useId();
  const [width, setWidth] = useState(256);
  const [height, setHeight] = useState(800);
  const [locale, setLocale] = useState<Locale>("zh-CN");
  const [scenario, setScenario] = useState<Scenario>("normal");
  const [feedback, setFeedback] = useState("");
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>("none");
  const c = COPY[locale];
  const review = REVIEW_COPY[locale];
  const scenarios: { value: Scenario; label: string }[] = [
    { value: "normal", label: c.normalScenario },
    { value: "empty", label: c.emptyScenario },
    { value: "loading", label: c.loadingScenario },
    { value: "error", label: c.errorScenario },
    { value: "remote", label: c.remoteScenario },
    { value: "directory", label: c.directoryScenario },
  ];
  return (
    <WorldStage padding={32} width={1280}>
      <Layer w={1216} x={32} y={32}>
        <Stack gap={32}>
          <Row align="center" gap={24} justify="space-between" wrap={false}>
            <Stack gap={4}>
              <Text as="h1" style={{ fontSize: 16 }}>
                {review.title}
              </Text>
              <Text style={{ fontSize: 12 }} tone="secondary">
                {c.previewOnly}
              </Text>
            </Stack>
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline">{review.options}</Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                style={{ width: 340, maxWidth: "calc(100vw - 24px)" }}
              >
                <Stack gap={12}>
                  <PopoverHeader>
                    <PopoverTitle>{review.options}</PopoverTitle>
                  </PopoverHeader>
                  <FieldGroup className="gap-3">
                    <Field orientation="horizontal">
                      <FieldLabel id={`${id}-scenario`}>
                        {c.scenario}
                      </FieldLabel>
                      <Select
                        onValueChange={(value) => {
                          const option = scenarios.find(
                            (item) => item.value === value
                          );
                          if (!option) {
                            return;
                          }
                          setScenario(option.value);
                          setFeedback("");
                        }}
                        value={scenario}
                      >
                        <SelectTrigger
                          aria-labelledby={`${id}-scenario`}
                          style={{ width: 176 }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {scenarios.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel id={`${id}-update`}>
                        {review.updateState}
                      </FieldLabel>
                      <Select
                        onValueChange={(value) => {
                          if (
                            value !== "none" &&
                            value !== "available" &&
                            value !== "downloading" &&
                            value !== "downloaded"
                          ) {
                            return;
                          }
                          setUpdatePhase(value);
                          setFeedback("");
                        }}
                        value={updatePhase}
                      >
                        <SelectTrigger
                          aria-labelledby={`${id}-update`}
                          style={{ width: 176 }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {(
                              [
                                "none",
                                "available",
                                "downloading",
                                "downloaded",
                              ] as const
                            ).map((value) => (
                              <SelectItem key={value} value={value}>
                                {review.updates[value]}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel id={`${id}-language`}>
                        {c.language}
                      </FieldLabel>
                      <Select
                        onValueChange={(value) => {
                          const option = REVIEW_LANGUAGES.find(
                            (item) => item.value === value
                          );
                          if (!option) {
                            return;
                          }
                          setLocale(option.value);
                          setFeedback("");
                        }}
                        value={locale}
                      >
                        <SelectTrigger
                          aria-labelledby={`${id}-language`}
                          style={{ width: 176 }}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectGroup>
                            {REVIEW_LANGUAGES.map((option) => (
                              <SelectItem
                                key={option.value}
                                value={option.value}
                              >
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel id={`${id}-width`}>{c.width}</FieldLabel>
                      <ToggleGroup
                        aria-labelledby={`${id}-width`}
                        onValueChange={(value) => {
                          if (
                            value !== "224" &&
                            value !== "256" &&
                            value !== "320"
                          ) {
                            return;
                          }
                          setWidth(Number(value));
                          setFeedback("");
                        }}
                        type="single"
                        value={String(width)}
                        variant="outline"
                      >
                        <ToggleGroupItem value="224">224</ToggleGroupItem>
                        <ToggleGroupItem value="256">256</ToggleGroupItem>
                        <ToggleGroupItem value="320">320</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                    <Field orientation="horizontal">
                      <FieldLabel id={`${id}-height`}>
                        {review.height}
                      </FieldLabel>
                      <ToggleGroup
                        aria-labelledby={`${id}-height`}
                        onValueChange={(value) => {
                          if (value !== "560" && value !== "800") {
                            return;
                          }
                          setHeight(Number(value));
                          setFeedback("");
                        }}
                        type="single"
                        value={String(height)}
                        variant="outline"
                      >
                        <ToggleGroupItem value="560">560</ToggleGroupItem>
                        <ToggleGroupItem value="800">800</ToggleGroupItem>
                      </ToggleGroup>
                    </Field>
                  </FieldGroup>
                </Stack>
              </PopoverContent>
            </Popover>
          </Row>
          <Row align="flex-start" gap={32} wrap>
            <Artboard
              height={height}
              title={`${width} × ${height}`}
              width={width}
            >
              <SidebarDesign
                key={locale}
                locale={locale}
                onFeedback={setFeedback}
                onScenarioChange={setScenario}
                onUpdatePhaseChange={setUpdatePhase}
                scenario={scenario}
                updatePhase={updatePhase}
                width={width}
              />
            </Artboard>
            <Stack gap={28} style={{ minWidth: 288, width: 896 }}>
              {feedback ? (
                <Text style={{ fontSize: 12 }} tone="secondary">
                  {feedback}
                </Text>
              ) : null}
              <Stack gap={8}>
                <Text as="h2" style={{ fontSize: 14 }}>
                  {review.peeksWorktree}
                </Text>
                <Text style={{ fontSize: 12 }} tone="secondary">
                  {review.peeksNote}
                </Text>
                <Row gap={16} wrap>
                  {WORKTREE_PEEK_SAMPLES.map((tree) => (
                    <PeekSpecimen
                      caption={worktreePeekCaption(tree, locale)}
                      key={tree.key}
                    >
                      <WorktreePeek locale={locale} tree={tree} />
                    </PeekSpecimen>
                  ))}
                </Row>
              </Stack>
            </Stack>
          </Row>
        </Stack>
      </Layer>
    </WorldStage>
  );
}
