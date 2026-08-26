import { Frame, Stack, Tabs, TabsContent, TabsList, TabsTrigger, Text } from "pier/canvas";
import { useState } from "react";
import { data } from "./model.ts";
import { DesignPage, LandingPage, OverviewPage, ProblemPage } from "./sections.tsx";

/**
 * decision_nav_4（design-doc）：速览 → 问题 → 设计 → 落地。无线日页。
 * 线框按「先主机后投影」顺序用 ArtboardStage 呈现，不定视觉。
 */
export const canvas = {
  description:
    "Pier 移动端：状态投影与受控闭环。线框锁定信息架构。",
  kind: "composition" as const,
  title: "Pier 移动端",
};

const VIEWS = [
  { id: "overview", label: "速览" },
  { id: "problem", label: "问题" },
  { id: "design", label: "设计" },
  { id: "landing", label: "落地" },
] as const;

export default function MobileCompanionCanvas() {
  const [tab, setTab] = useState("overview");

  return (
    <Frame maxWidth={1080}>
      <Stack gap={14}>
        <header>
          <Stack gap={5}>
            <Text
              as="h1"
              className="text-balance text-xl font-semibold leading-tight tracking-tight sm:text-2xl"
            >
              {data.meta.title}
            </Text>
            <Text className="max-w-3xl text-sm leading-relaxed" tone="secondary">
              {data.meta.subtitle}
            </Text>
            <Text className="font-mono text-xs" tone="tertiary">
              {data.meta.baseline}
            </Text>
          </Stack>
        </header>

        <Tabs onValueChange={setTab} value={tab}>
          <TabsList className="flex w-full justify-start gap-1 overflow-x-auto">
            {VIEWS.map((view) => (
              <TabsTrigger
                className="whitespace-nowrap"
                key={view.id}
                value={view.id}
              >
                {view.label}
              </TabsTrigger>
            ))}
          </TabsList>

          <TabsContent className="mt-5" value="overview">
            <OverviewPage d={data} />
          </TabsContent>
          <TabsContent className="mt-5" value="problem">
            <ProblemPage d={data} />
          </TabsContent>
          <TabsContent className="mt-5" value="design">
            <DesignPage d={data} />
          </TabsContent>
          <TabsContent className="mt-5" value="landing">
            <LandingPage d={data} />
          </TabsContent>
        </Tabs>
      </Stack>
    </Frame>
  );
}
