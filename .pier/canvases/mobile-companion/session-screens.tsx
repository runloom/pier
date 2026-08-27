import { Row, Stack, Text } from "pier/canvas";
import { AppNav, Band, Box, SessionTabs } from "./chrome.tsx";

function SessionHead({ title, hint }: { hint: string; title: string }) {
  return (
    <Band title="1 返回 + 身份">
      <Text className="text-xs">‹ 工作台 · {title}</Text>
      <Text className="text-[10px]" tone="secondary">
        {hint}
      </Text>
    </Band>
  );
}

export function ScreenS1() {
  return (
    <Stack className="h-full" gap={0}>
      <SessionHead hint="工作树 · 需要你处理" title="会话标题" />
      <SessionTabs active="term" />
      <Band grow title="2 终端投影 · 默认 T1">
        <Box>
          <Text className="font-mono text-[10px]">当前屏幕</Text>
          <Text className="text-[10px]" tone="tertiary">
            无色彩 · 切回才刷新
          </Text>
        </Box>
        <Box dashed>
          <Text className="text-[10px]" tone="secondary">
            T2（增强）
          </Text>
        </Box>
      </Band>
      <Band title="3 审批条 · 仅 waiting">
        <Box hi>
          <Text className="text-xs">未决交互摘要</Text>
          <Row gap={6}>
            <Text className="flex-1 border border-foreground py-1 text-center text-[10px]">
              键级 n / Esc
            </Text>
            <Text className="flex-1 border border-foreground bg-foreground py-1 text-center text-[10px] text-background">
              键级 y / Enter
            </Text>
          </Row>
          <Box dashed>
            <Text className="text-[10px]" tone="secondary">
              语义批准 · 仅已验证智能体
            </Text>
          </Box>
        </Box>
      </Band>
      <Band title="4 附件键 · D2">
        <Box dashed>
          <Text className="text-[10px]" tone="secondary">
            未授权则隐藏。Tab / ^C / 方向键不是审批键
          </Text>
        </Box>
      </Band>
      <Band last title="5 一行输入 · D2 门">
        <Box dashed>
          <Text className="text-[10px]" tone="secondary">
            未授权则只展示锁定说明
          </Text>
        </Box>
      </Band>
    </Stack>
  );
}

export function ScreenS2() {
  return (
    <Stack className="h-full" gap={0}>
      <SessionHead hint="工作树 · 只读 git" title="会话标题" />
      <SessionTabs active="diff" />
      <Band title="2 文件列表">
        <Box>
          <Row justify="space-between">
            <Text className="font-mono text-[10px]">path/a.ts</Text>
            <Text className="text-[10px]">+ / −</Text>
          </Row>
        </Box>
        <Box>
          <Row justify="space-between">
            <Text className="font-mono text-[10px]">path/b.ts</Text>
            <Text className="text-[10px]">+ / −</Text>
          </Row>
        </Box>
      </Band>
      <Band grow title="3 hunk">
        <Box>
          <Text className="text-[10px]">只读 diff 文本</Text>
          <Text className="text-[10px]" tone="tertiary">
            只读
          </Text>
        </Box>
      </Band>
      <Band last title="4 可选评语">
        <Box dashed>
          <Text className="text-[10px]" tone="secondary">
            一行输入 · 同 D2
          </Text>
        </Box>
      </Band>
    </Stack>
  );
}

export function ScreenS3() {
  return (
    <Stack className="h-full" gap={0}>
      <SessionHead hint="当前工作树 · 只读浏览" title="会话标题" />
      <SessionTabs active="files" />
      <Band title="2 目录">
        <Box>
          <Text className="font-mono text-[10px]">src/</Text>
        </Box>
        <Box hi>
          <Text className="font-mono text-[10px]">src/a.ts</Text>
        </Box>
        <Box>
          <Text className="font-mono text-[10px]">README.md</Text>
        </Box>
      </Band>
      <Band grow last title="3 预览">
        <Box>
          <Text className="text-[10px]">只读文件内容</Text>
          <Text className="text-[10px]" tone="tertiary">
            只读预览
          </Text>
        </Box>
      </Band>
    </Stack>
  );
}

export function ScreenN1() {
  return (
    <Stack className="h-full" gap={0}>
      <Band title="1 标题 + 动作">
        <Row justify="space-between">
          <Text className="text-xs">通知 · 开发机</Text>
          <Text className="border border-foreground px-1.5 py-0.5 text-[10px]">
            全部已读
          </Text>
        </Row>
        <Text className="text-[10px]" tone="tertiary">
          当前主机收件箱
        </Text>
      </Band>
      <Band grow title="2 列表">
        <Box hi>
          <Row justify="space-between">
            <Text className="text-xs font-medium">未读 · 标题</Text>
            <Text className="text-[10px]" tone="tertiary">
              相对时间
            </Text>
          </Row>
          <Text className="text-[10px]" tone="secondary">
            详情（下一步 / 摘要）· 进该机会话
          </Text>
        </Box>
        <Box>
          <Text className="text-xs">已读 · 标题</Text>
        </Box>
      </Band>
      <AppNav active="inbox" />
    </Stack>
  );
}
