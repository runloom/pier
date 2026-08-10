import {
  Alert,
  AlertDescription,
  AlertTitle,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemTitle,
  Row,
  Stack,
  Text,
} from "pier/canvas";
import type { SchemeData } from "./model.ts";
import { StatusBadge, SubTitle } from "./shared.tsx";

type RuntimeUi = SchemeData["data"]["runtimeUi"];

/** 持久会话协作台静态原型：一次性回复不进入此界面。 */
export function AgentCollaborationPrototype({ ui }: { ui: RuntimeUi }) {
  return (
    <Card size="sm">
      <CardHeader>
        <Row align="center" justify="space-between" gap={12} wrap>
          <Stack gap={2}>
            <CardTitle>{ui.workspace.title}</CardTitle>
            <CardDescription>{ui.workspace.meta}</CardDescription>
          </Stack>
          <StatusBadge label={ui.workspace.status} tone="outline" />
        </Row>
        <Text tone="tertiary" className="text-xs leading-relaxed">
          {ui.disclaimer}
        </Text>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-5">
          <section className="min-w-0" style={{ flex: "7 1 32rem" }}>
            <Stack gap={12}>
              <Stack gap={6}>
                <Row align="center" justify="space-between" gap={8} wrap>
                  <SubTitle>所选工作智能体</SubTitle>
                  <StatusBadge label={ui.selected.state} />
                </Row>
                <Text className="text-sm font-medium">{ui.selected.name}</Text>
                <div className="grid gap-1 text-xs leading-relaxed text-muted-foreground sm:grid-cols-2">
                  <span className="break-words">当前运行：{ui.selected.runtime}</span>
                  <span className="break-words">所在位置：{ui.selected.location}</span>
                  <span className="break-words sm:col-span-2">工作树：{ui.selected.worktree}</span>
                </div>
                <Text tone="secondary" className="text-xs leading-relaxed">
                  {ui.selected.summary}
                </Text>
              </Stack>

              <Alert variant="warning">
                <AlertTitle>{ui.attention.title}</AlertTitle>
                <AlertDescription className="text-xs leading-relaxed">
                  {ui.attention.reason} 下一步：{ui.attention.next}
                </AlertDescription>
              </Alert>

              <Stack gap={6}>
                <SubTitle>当前现场与可读取内容</SubTitle>
                <Text tone="secondary" className="text-xs leading-relaxed">
                  {ui.contentBoundary}
                </Text>
                <ItemGroup className="grid gap-2 sm:grid-cols-2">
                  {ui.facts.map((fact) => (
                    <Item className="min-w-0" key={fact.fact} size="xs" variant="muted">
                      <ItemContent className="min-w-0">
                        <ItemTitle>{fact.fact}</ItemTitle>
                        <ItemDescription className="leading-relaxed">{fact.meaning}</ItemDescription>
                        <Text tone="tertiary" className="text-xs break-words">
                          {fact.source} · {fact.observedAt}
                        </Text>
                      </ItemContent>
                    </Item>
                  ))}
                </ItemGroup>
              </Stack>
            </Stack>
          </section>

          <section className="min-w-0" style={{ flex: "5 1 22rem" }}>
            <Stack gap={8}>
              <SubTitle>协调者与工作智能体</SubTitle>
              <ItemGroup className="grid gap-2">
                {ui.sessions.map((session) => (
                  <Item className="min-w-0" key={session.id} size="xs" variant="outline">
                    <ItemContent className="min-w-0">
                      <ItemTitle>{session.name}</ItemTitle>
                      <ItemDescription>{session.provider}</ItemDescription>
                      <div className="grid gap-1 text-xs leading-relaxed text-muted-foreground">
                        <span className="break-words">当前运行：{session.runtime}</span>
                        <span className="break-words">所在位置：{session.location}</span>
                        <span className="break-words">工作树：{session.worktree}</span>
                      </div>
                      <Text tone="tertiary" className="text-xs leading-relaxed">
                        {session.summary}
                      </Text>
                    </ItemContent>
                    <ItemActions>
                      <StatusBadge label={session.status} />
                    </ItemActions>
                  </Item>
                ))}
              </ItemGroup>
            </Stack>
          </section>
        </div>
      </CardContent>
    </Card>
  );
}
