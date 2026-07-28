import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  DataChart,
  MermaidDiagram,
  Progress,
  Separator,
  Textarea,
} from "pier/canvas";
import { useState } from "react";
import {
  BOUNDARY_VIEWS,
  CAPABILITY_EVIDENCE,
  CHART_DATA,
  CONTROLLED_BRIDGE_CAPABILITIES,
  DIAGRAM_FAMILIES,
  EVIDENCE_STATE_META,
  FIXED_SHELL_CAPABILITIES,
  FREE_CANVAS_CAPABILITIES,
  MERMAID_EXAMPLES,
  PRODUCT_STEPS,
  SYSTEM_CAPABILITIES,
  VIEWPORT_MODES,
  type BoundaryView,
  type ChartType,
  type MermaidExample,
  type ViewportMode,
} from "./canvas-capabilities.model.ts";
import { Owner, Rule } from "./canvas-capabilities.primitives.tsx";

export function OverviewSurface() {
  const verified = CAPABILITY_EVIDENCE.filter(
    (item) => item.state === "verified"
  ).length;
  const ready = CAPABILITY_EVIDENCE.filter(
    (item) => item.state !== "planned"
  ).length;
  const progress = Math.round((ready / CAPABILITY_EVIDENCE.length) * 100);

  return (
    <main className="cc-surface">
      <Card className="cc-panel cc-overview-hero">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>当前能力判断</span>
            <Badge variant="info">以证据为准</Badge>
          </div>
          <CardTitle>基础图表已经可用，宿主边界是下一阶段</CardTitle>
          <CardDescription>
            当前可以真实试用 Mermaid、数据图表和节点关系图；多框架已经接入编译入口，但运行闭环、有限视口和文件能力仍需继续完成。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-overview-progress">
            <Progress value={progress} />
            <span>
              {ready} / {CAPABILITY_EVIDENCE.length} 项已有可观察产出，其中{" "}
              {verified} 项具备自动测试证据
            </span>
          </div>
        </CardContent>
      </Card>

      <div className="cc-overview-grid">
        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>能力地图</span>
              <Badge variant="done">逐项可追踪</Badge>
            </div>
            <CardTitle>不要把“存在”误写成“完成”</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="cc-capability-map">
              {CAPABILITY_EVIDENCE.map((item) => {
                const state = EVIDENCE_STATE_META[item.state];
                return (
                  <article key={item.id}>
                    <div>
                      <strong>{item.title}</strong>
                      <Badge size="xs" variant={state.variant}>
                        {state.label}
                      </Badge>
                    </div>
                    <p>{item.coverage}</p>
                  </article>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="cc-overview-side">
          <Card className="cc-panel">
            <CardHeader>
              <div className="cc-panel__eyebrow">
                <span>下一处缺口</span>
                <Badge variant="warning">T7</Badge>
              </div>
              <CardTitle>补齐四框架真实运行闭环</CardTitle>
              <CardDescription>
                编译成功只证明入口可用；下一步必须分别验证挂载、更新、事件回传和卸载。
              </CardDescription>
            </CardHeader>
          </Card>

          <Card className="cc-panel">
            <CardHeader>
              <div className="cc-panel__eyebrow">
                <span>阅读顺序</span>
                <Badge variant="neutral">渐进展开</Badge>
              </div>
              <CardTitle>先试用，再看边界和证据</CardTitle>
            </CardHeader>
            <CardContent>
              <ol className="cc-reading-order">
                <li>
                  <span>1</span>在“试用”操作真实系统组件
                </li>
                <li>
                  <span>2</span>在“边界”确认固定与自由
                </li>
                <li>
                  <span>3</span>在“验证”检查状态依据
                </li>
                <li>
                  <span>4</span>在“路线”推进剩余任务
                </li>
              </ol>
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  );
}

export function PlaygroundSurface() {
  return (
    <main className="cc-surface">
      <ProductDesign />
    </main>
  );
}

export function BoundarySurface({
  activeView,
  setActiveView,
}: {
  activeView: BoundaryView;
  setActiveView: (view: BoundaryView) => void;
}) {
  return (
    <main className="cc-surface">
      <div
        aria-label="Canvas 边界视图"
        className="cc-view-switch"
        role="tablist"
      >
        {BOUNDARY_VIEWS.map((view, index) => (
          <Button
            key={view.id}
            aria-controls={`cc-boundary-${view.id}`}
            aria-selected={activeView === view.id}
            id={`cc-boundary-tab-${view.id}`}
            onClick={() => setActiveView(view.id)}
            onKeyDown={(event) => {
              const direction =
                event.key === "ArrowRight"
                  ? 1
                  : event.key === "ArrowLeft"
                    ? -1
                    : 0;
              if (direction === 0) {
                return;
              }
              event.preventDefault();
              const next =
                BOUNDARY_VIEWS[
                  (index + direction + BOUNDARY_VIEWS.length) %
                    BOUNDARY_VIEWS.length
                ];
              if (!next) {
                return;
              }
              setActiveView(next.id);
              document.getElementById(`cc-boundary-tab-${next.id}`)?.focus();
            }}
            role="tab"
            size="sm"
            tabIndex={activeView === view.id ? 0 : -1}
            type="button"
            variant={activeView === view.id ? "secondary" : "ghost"}
          >
            {view.label}
          </Button>
        ))}
        <span>同一能力从用户闭环追到实现证据</span>
      </div>

      {BOUNDARY_VIEWS.map((view) => (
        <div
          aria-labelledby={`cc-boundary-tab-${view.id}`}
          hidden={activeView !== view.id}
          id={`cc-boundary-${view.id}`}
          key={view.id}
          role="tabpanel"
        >
          {activeView === view.id && view.id === "freedom" ? (
            <FreedomDesign />
          ) : null}
          {activeView === view.id && view.id === "technology" ? (
            <TechnologyDesign />
          ) : null}
          {activeView === view.id && view.id === "skill" ? (
            <SkillDesign />
          ) : null}
        </div>
      ))}
    </main>
  );
}

function ProductDesign() {
  const [chartType, setChartType] = useState<ChartType>("bar");
  const [selectedCapability, setSelectedCapability] =
    useState("Mermaid 通用预览");
  const [mermaidExample, setMermaidExample] =
    useState<MermaidExample>("flowchart");
  const [mermaidSource, setMermaidSource] = useState(
    MERMAID_EXAMPLES.flowchart.source
  );

  const selectMermaidExample = (example: MermaidExample) => {
    setMermaidExample(example);
    setMermaidSource(MERMAID_EXAMPLES[example].source);
  };

  return (
    <>
      <Card className="cc-panel">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>目标体验</span>
            <Badge variant="done">代表图型已验证 · 节点图增强</Badge>
          </div>
          <CardTitle>一个图表入口，两条渐进增强路径</CardTitle>
          <CardDescription>
            Mermaid 源码是通用兼容入口；XYFlow
            只增强适合节点与连线的图型，不重做整套 Mermaid。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-product-flow">
            {PRODUCT_STEPS.map((step) => (
              <article key={step.index}>
                <span>{step.index}</span>
                <strong>{step.title}</strong>
                <p>{step.detail}</p>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="cc-capability-grid">
        <Card className="cc-panel cc-diagram-card">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>MermaidDiagram 代表图型验证</span>
              <Badge variant="info">源码即真源</Badge>
            </div>
            <CardTitle>修改源码，立即验证不同图型</CardTitle>
            <CardDescription>
              流程图、序列图和甘特图走同一系统入口；这三类已有测试证据，其余官方图型待逐型回归。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-chart-toolbar">
              {(Object.keys(MERMAID_EXAMPLES) as MermaidExample[]).map(
                (example) => (
                  <Button
                    key={example}
                    aria-pressed={mermaidExample === example}
                    onClick={() => selectMermaidExample(example)}
                    size="xs"
                    type="button"
                    variant={
                      mermaidExample === example ? "secondary" : "ghost"
                    }
                  >
                    {MERMAID_EXAMPLES[example].label}
                  </Button>
                )
              )}
              <span>
                当前字符：<strong>{mermaidSource.length}</strong>
              </span>
            </div>
            <div className="cc-mermaid-workbench">
              <div className="cc-mermaid-source">
                <span>MERMAID SOURCE</span>
                <Textarea
                  aria-label="Mermaid 源码"
                  onChange={(event) => setMermaidSource(event.target.value)}
                  spellCheck={false}
                  value={mermaidSource}
                />
              </div>
              <MermaidDiagram
                aria-label={`${MERMAID_EXAMPLES[mermaidExample].label}预览`}
                className="cc-mermaid-preview"
                source={mermaidSource}
              />
            </div>
          </CardContent>
        </Card>

        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>系统能力</span>
              <Badge variant="info">稳定外观</Badge>
            </div>
            <CardTitle>第一版能力清单</CardTitle>
            <CardDescription>
              Pier 持有协议、主题、安全和生命周期；三方库持有渲染、布局与视口。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-system-list">
              {SYSTEM_CAPABILITIES.map((item) => (
                <article key={item.label}>
                  <div>
                    <code>{item.label}</code>
                    <Badge size="xs" variant={item.variant}>
                      {item.state}
                    </Badge>
                  </div>
                  <p>{item.detail}</p>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="cc-product-evidence">
        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>图型与编辑方式</span>
              <Badge variant="done">不强行统一引擎</Badge>
            </div>
            <CardTitle>Mermaid 是兼容面，不是唯一渲染器</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="cc-family-grid">
              {DIAGRAM_FAMILIES.map((item) => (
                <article key={item.family}>
                  <div>
                    <strong>{item.family}</strong>
                    <code>{item.renderer}</code>
                  </div>
                  <p>{item.examples}</p>
                  <small>{item.edit}</small>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="cc-panel cc-chart-card">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>DataChart 边界验证</span>
              <Badge variant="success">Recharts</Badge>
            </div>
            <CardTitle>统计图展示真实证据层级</CardTitle>
            <CardDescription>
              3 表示自动验证，2 表示已接入，1 表示已演示，0
              表示规划中；数值不再表示没有定义的“覆盖量”。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="cc-chart-toolbar">
              {(["bar", "line", "area", "donut"] as const).map((type) => (
                <Button
                  key={type}
                  aria-pressed={chartType === type}
                  onClick={() => setChartType(type)}
                  size="xs"
                  type="button"
                  variant={chartType === type ? "secondary" : "ghost"}
                >
                  {type === "bar"
                    ? "柱状"
                    : type === "line"
                      ? "折线"
                      : type === "area"
                        ? "面积"
                        : "环形"}
                </Button>
              ))}
              <span>
                当前关注：<strong>{selectedCapability}</strong>
              </span>
            </div>
            <DataChart
              aria-label="Canvas 系统能力覆盖图"
              categoryKey="capability"
              data={CHART_DATA}
              height={220}
              onDatumSelect={(datum) =>
                setSelectedCapability(String(datum.capability))
              }
              series={[{ key: "evidenceLevel", label: "证据层级" }]}
              showLegend={false}
              type={chartType}
            />
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function FreedomDesign() {
  const [viewport, setViewport] = useState<ViewportMode>("full-bleed");
  const selectedViewport =
    VIEWPORT_MODES.find((item) => item.id === viewport) ?? VIEWPORT_MODES[0]!;

  return (
    <div className="cc-freedom-stack">
      <Card className="cc-panel cc-shell-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>产品边界预览</span>
            <Badge variant="warning">真实宿主待接入</Badge>
          </div>
          <CardTitle>用户生成完整内容 UI，Pier 只固定运行规则</CardTitle>
          <CardDescription>
            页面导航、布局、视觉和局部交互属于 Canvas；下方只预览三种视口语义，当前尚未改变真实
            CanvasHost。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-viewport-toolbar">
            {VIEWPORT_MODES.map((mode) => (
              <Button
                key={mode.id}
                aria-pressed={viewport === mode.id}
                onClick={() => setViewport(mode.id)}
                size="xs"
                type="button"
                variant={viewport === mode.id ? "secondary" : "ghost"}
              >
                {mode.label}
              </Button>
            ))}
            <span>
              {selectedViewport.owner} · {selectedViewport.detail}
            </span>
          </div>

          <div className="cc-shell-preview" data-viewport={viewport}>
            <div className="cc-shell-chrome">
              <code>PIER HOST</code>
              <span>挂载 · 诊断 · 重载 · 可信状态</span>
              <Badge size="xs" variant="neutral">
                固定
              </Badge>
            </div>
            <div className="cc-shell-stage">
              <section className="cc-free-canvas">
                <div>
                  <span>CANVAS CONTENT</span>
                  <Badge size="xs" variant="success">
                    自由
                  </Badge>
                </div>
                <strong>不同目标可以生成完全不同的内容 UI</strong>
                <div className="cc-free-composition">
                  <span>导航</span>
                  <span>业务组件</span>
                  <span>图表</span>
                  <span>局部交互</span>
                </div>
              </section>
              <aside className="cc-bridge-rail">
                <span>受控能力桥</span>
                <code>visualizations</code>
                <code>files</code>
                <code>capabilities</code>
              </aside>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="cc-boundary-grid">
        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>宿主所有权</span>
              <Badge variant="done">固定能力</Badge>
            </div>
            <CardTitle>每个 Canvas 都必须一致</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="cc-boundary-list">
              {FIXED_SHELL_CAPABILITIES.map(([title, detail]) => (
                <article key={title}>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>作者所有权</span>
              <Badge variant="success">自由能力</Badge>
            </div>
            <CardTitle>由用户或智能体完整生成</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="cc-boundary-list">
              {FREE_CANVAS_CAPABILITIES.map(([title, detail]) => (
                <article key={title}>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card className="cc-panel">
          <CardHeader>
            <div className="cc-panel__eyebrow">
              <span>系统能力入口</span>
              <Badge variant="warning">受控能力</Badge>
            </div>
            <CardTitle>按协议开放，不暴露宿主内部</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="cc-bridge-list">
              {CONTROLLED_BRIDGE_CAPABILITIES.map(
                ([title, capability, state]) => (
                  <article key={title}>
                    <strong>{title}</strong>
                    <code>{capability}</code>
                    <small>{state}</small>
                  </article>
                )
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card className="cc-panel cc-trust-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>可信边界</span>
            <Badge variant="warning">当前不是沙箱</Badge>
          </div>
          <CardTitle>自由生成建立在“用户已打开并信任项目”之上</CardTitle>
          <CardDescription>
            当前 Canvas 与宿主共享渲染进程和 JavaScript
            运行环境；编译围栏能约束 import，但不能把任意运行代码变成安全的第三方内容。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-trust-flow">
            <span>打开可信项目</span>
            <b>→</b>
            <span>生成可审查源码</span>
            <b>→</b>
            <span>围栏编译与受控能力</span>
            <b>→</b>
            <span>宿主内运行</span>
          </div>
          <Separator />
          <div className="cc-skill-rules">
            <Rule label="必须" text="固定壳只管理运行规则，不规定 Canvas 页面结构" />
            <Rule label="必须" text="共享给不可信来源前，先设计独立运行环境与按主体授权" />
            <Rule label="禁止" text="允许 Canvas 直接依赖宿主内部模块或 window.pier" />
            <Rule label="禁止" text="把代码生成式自由 UI 宣传成所见即所得搭建器" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TechnologyDesign() {
  return (
    <div className="cc-tech-grid">
      <Card className="cc-panel cc-tech-flow-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>控制流</span>
            <Badge variant="success">单向所有权</Badge>
          </div>
          <CardTitle>固定宿主运行规则，自由组合内容 UI</CardTitle>
          <CardDescription>
            Canvas 只声明元数据并输出内容；宿主选择视口、注入能力并管理生命周期，底层能力再选择具体引擎。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-tech-flow">
            <TechLayer
              code="*.canvas.*"
              detail="任意内容结构、项目组件、局部状态、业务数据和作用域样式"
              title="自由内容 UI"
            />
            <span>↓</span>
            <TechLayer
              code="canvas meta"
              detail="kind、title、description、viewport 与显式能力声明"
              title="有限元数据"
            />
            <span>↓</span>
            <TechLayer
              code="CanvasHost"
              detail="视口、主题、编译反馈、可信状态、挂载与卸载"
              title="固定运行壳"
            />
            <span>↓</span>
            <TechLayer
              code="pier/canvas + pier/visualizations"
              detail="按协议提供组件、图表、文件与后续宿主动作"
              title="受控能力桥"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="cc-panel">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>底层职责</span>
            <Badge variant="info">必须实现</Badge>
          </div>
          <CardTitle>Pier 持有治理，不持有图算法</CardTitle>
          <CardDescription>
            宿主只固定运行环境与能力边界；作者拥有内容，三方库拥有图算法。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-owner-grid">
            <Owner label="内容与局部状态" value="Canvas 作者" />
            <Owner label="视口与生命周期" value="CanvasHost" />
            <Owner label="能力协议" value="Pier 共享契约" />
            <Owner label="执行与算法" value="框架适配器 / 三方库" />
            <Owner label="可信与路径策略" value="宿主围栏" />
            <Owner label="验收" value="契约 + 挂载 + 行为 + 卸载" />
          </div>
          <Separator />
          <div className="cc-ban-list">
            <span>禁止</span>
            <p>固定所有 Canvas 的页面布局</p>
            <p>Canvas 自己复制宿主生命周期</p>
            <p>把可信项目运行模型称为沙箱</p>
            <p>直接访问宿主内部 API</p>
          </div>
        </CardContent>
      </Card>

      <Card className="cc-panel cc-framework-card">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>多框架终态</span>
            <Badge variant="done">编译入口已验证</Badge>
          </div>
          <CardTitle>共享宿主能力，不复制四套图引擎</CardTitle>
          <CardDescription>
            四种框架已经能引用同一能力桥；非 React
            框架仍需补齐真实挂载、更新、事件与卸载测试。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-frameworks">
            <Framework name="React" path="<Diagram />" state="运行入口已验证" />
            <Framework name="Vue" path="mountDiagram" state="编译入口已验证" />
            <Framework name="Solid" path="mountDiagram" state="编译入口已验证" />
            <Framework name="Svelte" path="mountDiagram" state="编译入口已验证" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function SkillDesign() {
  return (
    <div className="cc-skill-grid">
      <Card className="cc-panel">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>/canvas Skill</span>
            <Badge variant="info">生成闭环</Badge>
          </div>
          <CardTitle>Skill 负责选型与验收，不复制系统组件</CardTitle>
          <CardDescription>
            先区分自由内容与宿主能力，再选择视口、框架和图表入口；生成结果保持可审查。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="cc-skill-flow">
            {[
              ["1", "识别目标", "文档 / 工作台 / 全幅工具 / 图表"],
              ["2", "选择视口", "document / workspace / full-bleed"],
              ["3", "划分边界", "自由内容 / 固定壳 / 受控能力"],
              ["4", "生成入口", "*.canvas.* + 可选数据真源"],
              ["5", "运行验收", "编译、尺寸、交互、反馈、卸载"],
              ["6", "留下证据", "三种宽度、关键行为与失败路径"],
            ].map(([index, title, detail]) => (
              <article key={index}>
                <span>{index}</span>
                <div>
                  <strong>{title}</strong>
                  <small>{detail}</small>
                </div>
              </article>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card className="cc-panel">
        <CardHeader>
          <div className="cc-panel__eyebrow">
            <span>Skill 输入输出</span>
            <Badge variant="done">可验证</Badge>
          </div>
          <CardTitle>每次生成都带证据</CardTitle>
          <CardDescription>
            Skill 不能只写文件；必须把需求映射到可观察结果和失败修复路径。
          </CardDescription>
        </CardHeader>
        <CardContent>
          <dl className="cc-skill-io">
            <div>
              <dt>输入</dt>
              <dd>表达目标、视口模式、数据来源、交互方式、目标框架</dd>
            </div>
            <div>
              <dt>决策</dt>
              <dd>自由内容、宿主能力、可信来源与图表实现路径</dd>
            </div>
            <div>
              <dt>输出</dt>
              <dd>Canvas 入口、有限元数据、数据真源和完成证据</dd>
            </div>
            <div>
              <dt>验收</dt>
              <dd>真实挂载、视口尺寸、关键点击、失败反馈、卸载无残留</dd>
            </div>
          </dl>
          <Separator />
          <div className="cc-skill-rules">
            <Rule label="必须" text="只从文档、工作区、全幅中选择一种视口" />
            <Rule label="必须" text="自由生成内容 UI，优先复用受控系统能力" />
            <Rule label="禁止" text="在 Canvas 内复制加载、诊断和重载等宿主壳" />
            <Rule label="禁止" text="未验证尺寸、交互与卸载就声明生成完成" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function TechLayer({
  code,
  detail,
  title,
}: {
  code: string;
  detail: string;
  title: string;
}) {
  return (
    <article>
      <div>
        <strong>{title}</strong>
        <code>{code}</code>
      </div>
      <p>{detail}</p>
    </article>
  );
}

function Framework({
  name,
  path,
  state,
}: {
  name: string;
  path: string;
  state: string;
}) {
  return (
    <article>
      <strong>{name}</strong>
      <code>{path}</code>
      <small>{state}</small>
    </article>
  );
}
