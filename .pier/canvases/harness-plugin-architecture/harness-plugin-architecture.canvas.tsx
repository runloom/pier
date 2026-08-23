import { Frame, Stack, Tabs, TabsContent, TabsList, TabsTrigger, Text } from "pier/canvas";
import { useState } from "react";
import { data } from "./model.ts";
import { DesignPage, LandingPage, OverviewPage, ProblemPage } from "./sections.tsx";

/**
 * decision_nav_4 (design-doc)：速览 → 问题 → 设计 → 落地。
 * 内容唯一来源是相邻 data.json（经 model.ts 校验）；本文件只负责导航与排版。
 */
export const canvas = {
  description:
    "Pier · pi · deepseek-harness · herdr 四家插件机制的源码级对比：发现、装载、授权、运行、回收与信任模型。",
  kind: "composition" as const,
  title: "AI Harness 插件机制架构对比",
};

const VIEWS = [
  { id: "overview", label: "速览" },
  { id: "problem", label: "问题" },
  { id: "design", label: "设计" },
  { id: "landing", label: "落地" },
] as const;

export default function HarnessPluginArchitectureCanvas() {
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
