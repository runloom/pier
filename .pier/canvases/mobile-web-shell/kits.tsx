import { Row, Stack, Text } from "pier/canvas";
import type { ReactNode } from "react";
import { HitButton, PressRow, SectionLabel } from "./chrome.tsx";

export function PressKitScreen(): ReactNode {
  return (
    <div className="flex h-full flex-col gap-4 bg-background p-4 text-foreground">
      <Stack gap={6}>
        <Text as="h3">按下态</Text>
        <Text tone="secondary">
          系统点击高亮已被清掉。主路径必须自绘按下底，不能靠 hover。
        </Text>
      </Stack>
      <SectionLabel>列表行</SectionLabel>
      <PressRow>
        <p className="flex-1 text-sm">静止</p>
        <span className="text-muted-foreground">›</span>
      </PressRow>
      <PressRow pressed>
        <p className="flex-1 text-sm">按下（按住看）</p>
        <span className="text-muted-foreground">›</span>
      </PressRow>
      <SectionLabel>主按钮</SectionLabel>
      <Row gap={8}>
        <HitButton className="flex-1">主按钮</HitButton>
        <HitButton className="flex-1" variant="outline">
          次要
        </HitButton>
      </Row>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        主路径命中 44px。不要把桌面 28px 控件直接搬进手机。
      </p>
    </div>
  );
}

export function MotionKitScreen(): ReactNode {
  return (
    <div className="flex h-full flex-col gap-4 bg-background p-4 text-foreground">
      <Stack gap={6}>
        <Text as="h3">页面过渡</Text>
        <Text tone="secondary">
          横滑只表示更深一层。没有底栏。主机和工作台是父子，通知是当前机上的铃铛。
        </Text>
      </Stack>
      <SectionLabel>推入 · 220ms · 从右进</SectionLabel>
      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2">
          <div className="flex h-12 flex-1 items-center rounded-xl border border-border bg-muted px-3 text-[11px]">
            主机
          </div>
          <span className="text-muted-foreground text-xs">→</span>
          <div className="flex h-12 flex-1 items-center rounded-xl border border-action-accent/40 bg-card px-3 text-[11px]">
            这台电脑
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex h-12 flex-1 items-center rounded-xl border border-border bg-muted px-3 text-[11px]">
            这台电脑
          </div>
          <span className="text-muted-foreground text-xs">→</span>
          <div className="flex h-12 flex-1 items-center rounded-xl border border-action-accent/40 bg-card px-3 text-[11px]">
            会话 / 通知
          </div>
        </div>
      </div>
      <SectionLabel>返回 · 同曲线反向</SectionLabel>
      <p className="text-[11px] text-muted-foreground leading-relaxed">
        有「返回」就必须有反向滑出。铃铛打开的是这台电脑的收件箱，不是第三个根面。
      </p>
    </div>
  );
}
