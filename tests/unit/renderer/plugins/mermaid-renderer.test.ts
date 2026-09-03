import { describe, expect, it, vi } from "vitest";
import { createMermaidRenderer } from "@/lib/plugins/mermaid/renderer.ts";
import { installSvgLayoutStubs } from "../../../support/svg-layout-stubs.ts";

installSvgLayoutStubs();

const OK_SVG = { svg: "<svg><text>ok</text></svg>" };

describe("createMermaidRenderer facade semantics", () => {
  it("caches successful renders and dedupes in-flight renders", async () => {
    const renderSvg = vi.fn(async () => OK_SVG);
    const renderer = createMermaidRenderer({ renderSvg });

    await expect(renderer.render("graph TD;A-->B")).resolves.toEqual({
      ok: true,
      svg: OK_SVG.svg,
    });
    // Cache hit: no second render.
    await expect(renderer.render("graph TD;A-->B")).resolves.toEqual({
      ok: true,
      svg: OK_SVG.svg,
    });
    expect(renderSvg).toHaveBeenCalledTimes(1);

    // In-flight dedupe: one engine call feeds both callers.
    let resolveSlow: ((value: { svg: string }) => void) | undefined;
    const slow = createMermaidRenderer({
      renderSvg: vi.fn(
        () => new Promise<{ svg: string }>((resolve) => (resolveSlow = resolve))
      ),
    });
    const first = slow.render("graph TD;X-->Y");
    const second = slow.render("graph TD;X-->Y");
    resolveSlow?.({ svg: "<svg>slow</svg>" });
    await expect(first).resolves.toEqual({ ok: true, svg: "<svg>slow</svg>" });
    await expect(second).resolves.toEqual({ ok: true, svg: "<svg>slow</svg>" });
    expect(slow).toBeTruthy();
  });

  it("rejects oversized sources without invoking the engine", async () => {
    const renderSvg = vi.fn(async () => OK_SVG);
    const renderer = createMermaidRenderer({ renderSvg });
    await expect(renderer.render("x".repeat(160_001))).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });
    expect(renderSvg).not.toHaveBeenCalled();
  });

  it("maps engine rejections to render-failed", async () => {
    const renderer = createMermaidRenderer({
      renderSvg: () => Promise.reject(new Error("parse error on line 2")),
    });
    await expect(renderer.render("graph TD;A-->")).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });
  });

  it("caps waiting at the timeout", async () => {
    vi.useFakeTimers();
    try {
      const renderer = createMermaidRenderer({
        renderSvg: () => new Promise<{ svg: string }>(() => undefined),
        timeoutMs: 100,
      });
      const result = renderer.render("graph TD;A-->B");
      await vi.advanceTimersByTimeAsync(100);
      await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("evicts the oldest cache entry beyond the cap", async () => {
    const renderSvg = vi.fn(async () => OK_SVG);
    const renderer = createMermaidRenderer({ renderSvg });
    for (let i = 0; i < 97; i += 1) {
      await renderer.render(`graph TD;N${i}-->Z`);
    }
    expect(renderSvg).toHaveBeenCalledTimes(97);
    // Entry 0 was evicted when entry 96 landed, so it renders again.
    await renderer.render("graph TD;N0-->Z");
    expect(renderSvg).toHaveBeenCalledTimes(98);
    // The most recent entry is still cached.
    await renderer.render("graph TD;N96-->Z");
    expect(renderSvg).toHaveBeenCalledTimes(98);
  });
});

/**
 * Compat corpus: compact / AI-authored sources that must render on the single
 * official engine (these used to target the beautiful-mermaid worker parser).
 * Assertions lock user-visible labels, not engine-internal DOM.
 */
describe("official-engine compatibility corpus", () => {
  const renderer = createMermaidRenderer();

  async function renderOk(source: string): Promise<string> {
    const result = await renderer.render(source);
    if (!result.ok) {
      throw new Error(`expected ok, got ${result.reason}`);
    }
    return result.svg;
  }

  it("renders compact flowcharts with the UI font", async () => {
    const svg = await renderOk("graph TD;A-->B");
    expect(svg).toContain("<svg");
    expect(svg).toContain("font-family:var(--font-sans)");
    const labeled = await renderOk("graph TD;A-->|ready; retry|B");
    expect(labeled).toContain("ready; retry");
  });

  it("expands compact classDiagram bodies", async () => {
    const svg = await renderOk(
      "classDiagram;class A {;+int x;+f();};class B;A --> B"
    );
    expect(svg).toContain("int");
    expect(svg).toContain("f()");
    const inheritance = await renderOk(
      "classDiagram;Animal <|-- Dog;Dog --> Food"
    );
    expect(inheritance).toContain("<svg");
  });

  it("keeps comments commenting to end of line", async () => {
    const svg = await renderOk("graph TD;%% hidden;A-->B\nC-->D");
    expect(svg).not.toContain('id="flowchart-A-');
    expect(svg).toContain('id="flowchart-C-');
  });

  it("strips leading comments before the header", async () => {
    const svg = await renderOk("%% model\nclassDiagram;class A {;+int x;}");
    expect(svg).toContain("int");
  });

  it("renders ER and sequence diagrams", async () => {
    const er = await renderOk("erDiagram\nCUSTOMER ||--o{ ORDER : places");
    expect(er).toContain("CUSTOMER");
    expect(er).toContain("places");
    const sequence = await renderOk(
      "sequenceDiagram;participant Alice;participant Bob;Alice-->>Bob: reply"
    );
    expect(sequence).toContain("reply");
  });

  it("keeps quoted arrows and punctuation labels intact", async () => {
    const quoted = await renderOk('graph TD;A["C-->D"]-->B');
    expect(quoted).toContain("C--&gt;D");
    const percent = await renderOk("graph TD;A-->|load 50%%; retry|B;B-->C");
    expect(percent).toContain("load 50%%; retry");
    const textEdge = await renderOk("graph TD;A -- retry(later --> B;B-->C");
    expect(textEdge).toContain("retry(later");
    const bidirectional = await renderOk("graph TD;A<-.->B");
    expect(bidirectional).toContain("stroke-dasharray");
  });

  it("renders sequence messages with punctuation verbatim", async () => {
    const quote = await renderOk(
      "sequenceDiagram;participant A;participant B;A->>B: James' request;B-->>A: done"
    );
    expect(quote).toContain("James' request");
    expect(quote).toContain("done");
    const paren = await renderOk(
      "sequenceDiagram;participant A;participant B;A->>B: retry (later;B-->>A: done"
    );
    expect(paren).toContain("retry (later");
    expect(paren).toContain("done");
  });

  it("renders CJK flowchart labels", async () => {
    const svg = await renderOk(
      [
        "flowchart LR",
        "A[renderer Run Task] --> B[解析显式动作与展示意图]",
        "B --> C[main 解析 executionKind 和并发策略]",
        "C --> D[main 创建或返回 TaskRun]",
        "D --> E[main 广播带版本的 TaskRunsSnapshot]",
        "E --> F{executionKind}",
        "F -- process --> G{renderer 有明确 default + auto-follow}",
        "G -- 是 --> H[native adapter 静默绑定]",
        "G -- 否 --> I[仅更新应用会话级入口]",
        "F -- pty --> J[复用或创建任务终端]",
        "H --> K[提交 selectedRunId 与 generation]",
        "K --> L[从最新快照投影标签]",
        "I --> L",
        "J --> L",
      ].join("\n")
    );
    expect(svg).toContain("auto-follow");
    expect(svg).toContain("解析显式动作与展示意图");
  });

  it("renders the diagram families the old worker engine could not", async () => {
    await renderOk("gantt\ntitle T\nsection S\nTask :a1, 2024-01-01, 30d");
    await renderOk("mindmap\nroot((m))\n  a\n  b");
    await renderOk('pie title Pets\n  "Dogs" : 3\n  "Cats" : 4');
    await renderOk("gitGraph\n  commit\n  commit");
    await renderOk("timeline\n  2020 : A\n  2021 : B");
  });

  it("follows official grammar: unquoted parens in node labels are rejected", async () => {
    // The old worker parser tolerated `A[Retry (later]`; the official engine
    // (like mermaid.live / GitHub) requires quotes around special chars.
    const result = await renderer.render("graph TD;A[Retry (later]-->B;B-->C");
    expect(result.ok).toBe(false);
  });
});

describe("direction layout through the facade", () => {
  it("keeps LR by default and hands the auto-td rewrite to the engine", async () => {
    // jsdom has no SVG layout, so direction cannot be asserted by viewport
    // aspect; lock the prepared source the engine receives instead.
    const renderSvg = vi.fn(async () => OK_SVG);
    const renderer = createMermaidRenderer({ renderSvg });
    const chain = "A-->B-->C-->D-->E-->F-->G-->H";

    await renderer.render(`flowchart LR\n  ${chain}`);
    expect(renderSvg).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.stringContaining("flowchart LR")
    );

    await renderer.render(
      `%%{pier: layout=auto-td}%%\nflowchart LR\n  ${chain}`
    );
    expect(renderSvg).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.stringContaining("flowchart TD")
    );
  });

  it("renders the auto-td opt-in on the official engine", async () => {
    const renderer = createMermaidRenderer();
    const result = await renderer.render(
      "%%{pier: layout=auto-td}%%\nflowchart LR\n  A-->B-->C-->D-->E-->F-->G-->H"
    );
    expect(result.ok).toBe(true);
  });

  it("honors the %%{init}%% ELK renderer opt-in", async () => {
    const renderer = createMermaidRenderer();
    const result = await renderer.render(
      '%%{init: {"flowchart": {"defaultRenderer": "elk"}}}%%\nflowchart LR\nA-->B-->C'
    );
    expect(result.ok).toBe(true);
  });
});
